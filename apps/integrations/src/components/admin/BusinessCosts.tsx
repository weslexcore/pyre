// Operating-costs manager rendered at the bottom of the business overview
// (/admin/business, admin-only): the place admins record what the building
// actually costs to run. Lists every definition from business_costs with a
// human reading of its shape, and offers a small form (with one-click presets
// for the costs we know we have — rent, laundry, firewood, Momence fees) to
// add, edit, or remove entries. Every mutation invalidates the overview cache
// and pokes the parent island so the profit numbers above repaint.

import { useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { BusinessCostRow } from '@/lib/db';
import type { BusinessCostsPayload } from '@/pages/api/admin/business-costs';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

const COSTS_URL = '/api/admin/business-costs';

const CATEGORIES = ['rent', 'software', 'supplies', 'services', 'fees', 'other'] as const;

const KINDS = [
  { key: 'recurring', label: 'Recurring' },
  { key: 'one_off', label: 'One-off purchase' },
  { key: 'per_open_hour', label: 'Per open hour' },
  { key: 'percent_of_revenue', label: '% of revenue' },
] as const;

const CADENCES = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
] as const;

type Kind = (typeof KINDS)[number]['key'];

interface FormState {
  name: string;
  category: string;
  kind: Kind;
  amount: string;
  cadence: string;
  monthlyCap: string;
  incurredOn: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
}

const emptyForm = (today: string): FormState => ({
  name: '',
  category: 'software',
  kind: 'recurring',
  amount: '',
  cadence: 'monthly',
  monthlyCap: '',
  incurredOn: today,
  effectiveFrom: `${today.slice(0, 7)}-01`,
  effectiveTo: '',
  notes: '',
});

/** One-click starting points for the costs we already know the shape of.
 * Amounts we don't know (subscription prices, the Momence fee rate) stay
 * blank for the admin to fill in. */
const PRESETS: Array<{ label: string; fill: Partial<FormState> }> = [
  {
    label: 'Rent',
    fill: {
      name: 'Rent',
      category: 'rent',
      kind: 'per_open_hour',
      amount: '50',
      monthlyCap: '4250',
    },
  },
  {
    label: 'Firewood cord',
    fill: { name: 'Firewood cord', category: 'supplies', kind: 'one_off', amount: '475' },
  },
  {
    label: 'Laundry',
    fill: {
      name: 'Laundry service',
      category: 'services',
      kind: 'recurring',
      amount: '200',
      cadence: 'biweekly',
    },
  },
  {
    label: 'Momence fees',
    fill: {
      name: 'Momence transaction fees',
      category: 'fees',
      kind: 'percent_of_revenue',
      amount: '',
    },
  },
  {
    label: 'Subscription',
    fill: { name: '', category: 'software', kind: 'recurring', amount: '', cadence: 'monthly' },
  },
];

const fmtMoney = (n: number): string =>
  `$${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)}`;

const fmtDay = (d: string): string =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const CADENCE_TEXT: Record<string, string> = {
  weekly: '/ week',
  biweekly: 'every 2 weeks',
  monthly: '/ month',
  yearly: '/ year',
};

/** Human reading of a cost row's shape: "$200 every 2 weeks", "$475 on
 * Aug 12, 2026", "$50 / open hour, capped at $4,250 / month", "3% of revenue". */
function describeCost(cost: BusinessCostRow): string {
  const amount = Number(cost.amount);
  let body: string;
  switch (cost.kind) {
    case 'recurring':
      body = `${fmtMoney(amount)} ${CADENCE_TEXT[cost.cadence ?? 'monthly']}`;
      break;
    case 'one_off':
      body = `${fmtMoney(amount)} on ${cost.incurred_on ? fmtDay(cost.incurred_on) : '?'}`;
      break;
    case 'per_open_hour':
      body = `${fmtMoney(amount)} / open hour${
        cost.monthly_cap !== null ? `, capped at ${fmtMoney(Number(cost.monthly_cap))} / month` : ''
      }`;
      break;
    case 'percent_of_revenue':
      body = `${amount}% of revenue`;
      break;
  }
  const window = [
    cost.effective_from ? `from ${fmtDay(cost.effective_from)}` : '',
    cost.effective_to ? `through ${fmtDay(cost.effective_to)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return window ? `${body} (${window})` : body;
}

/** JSON body for POST/PUT from the form; kind-irrelevant fields stay home. */
function toRequestBody(form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    category: form.category,
    kind: form.kind,
    amount: Number(form.amount),
    notes: form.notes.trim() || undefined,
  };
  if (form.kind === 'recurring') body.cadence = form.cadence;
  if (form.kind === 'per_open_hour' && form.monthlyCap.trim() !== '') {
    body.monthlyCap = Number(form.monthlyCap);
  }
  if (form.kind === 'one_off') {
    body.incurredOn = form.incurredOn;
  } else {
    body.effectiveFrom = form.effectiveFrom || undefined;
    body.effectiveTo = form.effectiveTo || undefined;
  }
  return body;
}

function toFormState(cost: BusinessCostRow, today: string): FormState {
  return {
    ...emptyForm(today),
    name: cost.name,
    category: cost.category,
    kind: cost.kind,
    amount: String(cost.amount),
    cadence: cost.cadence ?? 'monthly',
    monthlyCap: cost.monthly_cap !== null ? String(cost.monthly_cap) : '',
    incurredOn: cost.incurred_on ?? today,
    effectiveFrom: cost.effective_from ?? '',
    effectiveTo: cost.effective_to ?? '',
    notes: cost.notes ?? '',
  };
}

export function BusinessCosts({ today, onChanged }: { today: string; onChanged: () => void }) {
  const { data, error, loading, reload } = useCachedJson<BusinessCostsPayload>(COSTS_URL);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(today));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const startAdd = (fill?: Partial<FormState>) => {
    setEditingId(null);
    setForm({ ...emptyForm(today), ...fill });
    setFormError(null);
    setOpen(true);
  };

  const startEdit = (cost: BusinessCostRow) => {
    setEditingId(cost.id);
    setForm(toFormState(cost, today));
    setFormError(null);
    setOpen(true);
  };

  const afterMutation = async () => {
    invalidateJson(COSTS_URL);
    invalidateJson('/api/admin/business-overview');
    await reload();
    onChanged();
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(editingId ? `${COSTS_URL}?id=${editingId}` : COSTS_URL, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toRequestBody(form)),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setOpen(false);
      setEditingId(null);
      await afterMutation();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (cost: BusinessCostRow) => {
    if (!window.confirm(`Delete "${cost.name}"? Past periods will stop counting it.`)) return;
    try {
      const res = await fetch(`${COSTS_URL}?id=${cost.id}`, { method: 'DELETE' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await afterMutation();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const costs = data?.costs ?? [];

  return (
    <section className="space-y-3">
      <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
        Operating costs
      </h2>
      <p className="font-mono text-xs text-white/40">
        Everything here feeds the profit math above: subscriptions are spread across their period,
        purchases land on their day, rent accrues per open hour up to its monthly cap, and fees take
        their cut of each day's revenue.
      </p>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}
      {loading && <p className="font-mono text-sm text-white/40">Loading…</p>}

      {!loading && costs.length === 0 && (
        <p className="font-mono text-xs text-white/40">
          No costs recorded yet — start from a preset below.
        </p>
      )}

      {costs.length > 0 && (
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {costs.map((cost) => (
            <li key={cost.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[var(--pyre-creme)]">
                  {cost.name}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-white/30">
                    {cost.category}
                  </span>
                </p>
                <p className="font-mono text-xs text-white/40">{describeCost(cost)}</p>
                {cost.notes && <p className="font-mono text-xs text-white/30">{cost.notes}</p>}
              </div>
              <button type="button" className={buttonClass} onClick={() => startEdit(cost)}>
                Edit
              </button>
              <button type="button" className={buttonClass} onClick={() => void remove(cost)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-white/40">Add</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={buttonClass}
            onClick={() => startAdd(preset.fill)}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className={buttonClass} onClick={() => startAdd()}>
          Other
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded border border-white/10 bg-white/[0.03] p-4">
          <p className="font-mono text-xs uppercase tracking-wide text-white/40">
            {editingId ? 'Edit cost' : 'New cost'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              className={`${inputClass} w-56`}
              placeholder="Name"
              aria-label="Cost name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <select
              className={inputClass}
              aria-label="Category"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              aria-label="Cost kind"
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value as Kind })}
            >
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-white/40">
              {form.kind === 'percent_of_revenue'
                ? 'Percent'
                : form.kind === 'per_open_hour'
                  ? '$ / open hour'
                  : 'Amount $'}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              className={`${inputClass} w-28`}
              aria-label="Amount"
              value={form.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
            {form.kind === 'recurring' && (
              <select
                className={inputClass}
                aria-label="Cadence"
                value={form.cadence}
                onChange={(e) => set({ cadence: e.target.value })}
              >
                {CADENCES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            {form.kind === 'per_open_hour' && (
              <>
                <span className="font-mono text-xs text-white/40">Monthly cap $</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={`${inputClass} w-28`}
                  aria-label="Monthly cap"
                  value={form.monthlyCap}
                  onChange={(e) => set({ monthlyCap: e.target.value })}
                />
              </>
            )}
            {form.kind === 'one_off' && (
              <>
                <span className="font-mono text-xs text-white/40">Purchased on</span>
                <input
                  type="date"
                  className={inputClass}
                  aria-label="Purchase date"
                  value={form.incurredOn}
                  onChange={(e) => set({ incurredOn: e.target.value })}
                />
              </>
            )}
          </div>

          {form.kind !== 'one_off' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-white/40">Active from</span>
              <input
                type="date"
                className={inputClass}
                aria-label="Effective from"
                value={form.effectiveFrom}
                onChange={(e) => set({ effectiveFrom: e.target.value })}
              />
              <span className="font-mono text-xs text-white/40">until</span>
              <input
                type="date"
                className={inputClass}
                aria-label="Effective to"
                value={form.effectiveTo}
                onChange={(e) => set({ effectiveTo: e.target.value })}
              />
              <span className="font-mono text-xs text-white/30">
                (leave "until" empty while it's still active)
              </span>
            </div>
          )}

          <input
            type="text"
            className={`${inputClass} w-full`}
            placeholder="Notes (optional)"
            aria-label="Notes"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />

          {formError && (
            <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
              {formError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${buttonClass} border-white/40 text-white`}
              disabled={saving || !form.name.trim() || form.amount.trim() === ''}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add cost'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
