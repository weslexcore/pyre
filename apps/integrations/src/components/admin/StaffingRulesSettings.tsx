// The staffing rules editor in the board's ⚙ Settings panel (admins only):
// an ordered list of "shifts like this need N people" rules. The first
// enabled rule whose conditions all hold sets a shift's count; empty
// conditions match anything. Saving replaces the whole list and re-runs the
// Momence sync so the counts reach the board straight away — shifts whose
// count was set by hand keep theirs.

import {
  DOW_LABELS,
  describeStaffingRule,
  MAX_STAFF_NEEDED,
  type StaffingRule,
} from '@pyre/schedule-core';
import { useEffect, useState } from 'react';
import { buttonClass, compactInputClass, goldButtonClass } from '@/components/admin/ui';

interface RulesResponse {
  rules?: StaffingRule[];
  fallback?: number;
  sync?: { staffingUpdated: number } | { error: string };
  error?: string;
}

/** The labels the Momence sync gives its shifts (schedule-core labelForWindow). */
const SYNC_LABELS = ['Morning', 'Day', 'Afternoon', 'Evening'];

/** Monday-first, matching the board. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** A rule as edited: tags kept as typed text until save. */
type DraftRule = StaffingRule & { tagsText: string };

const toDraft = (rule: StaffingRule): DraftRule => ({ ...rule, tagsText: rule.tags.join(', ') });

const fromDraft = ({ tagsText, ...rule }: DraftRule): StaffingRule => ({
  ...rule,
  tags: tagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
});

const newRule = (): DraftRule =>
  toDraft({
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    days: [],
    shiftLabels: [],
    startsFrom: null,
    startsBefore: null,
    titleContains: null,
    tags: [],
    staffNeeded: 1,
  });

const chipClass = (active: boolean) =>
  `rounded border px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
    active
      ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export function StaffingRulesSettings({ onSaved }: { onSaved: () => void }) {
  const [saved, setSaved] = useState<DraftRule[] | null>(null);
  const [draft, setDraft] = useState<DraftRule[] | null>(null);
  const [fallback, setFallback] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/staffing-rules');
        const body = (await res.json()) as RulesResponse;
        if (cancelled) return;
        if (!res.ok || !body.rules) {
          setError(body.error ?? 'Could not load the staffing rules');
          return;
        }
        const rules = body.rules.map(toDraft);
        setSaved(rules);
        setDraft(rules);
        if (typeof body.fallback === 'number') setFallback(body.fallback);
      } catch {
        if (!cancelled) setError('Could not load the staffing rules');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!draft || !saved) {
    return (
      <p className="font-mono text-xs text-white/40">{error ?? 'Loading the staffing rules…'}</p>
    );
  }

  const dirty = JSON.stringify(draft.map(fromDraft)) !== JSON.stringify(saved.map(fromDraft));

  const update = (index: number, patch: Partial<DraftRule>) => {
    setNotice(null);
    setDraft(draft.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setNotice(null);
    setDraft(next);
  };

  const remove = (index: number) => {
    setNotice(null);
    setDraft(draft.filter((_, i) => i !== index));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/staffing-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: draft.map(fromDraft) }),
      });
      const body = (await res.json()) as RulesResponse;
      if (!res.ok || !body.rules) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const rules = body.rules.map(toDraft);
      setSaved(rules);
      setDraft(rules);
      if (body.sync && 'error' in body.sync) {
        setNotice(
          `Saved. Updating the shifts failed (${body.sync.error}) — the hourly sync will apply the rules.`
        );
      } else if (body.sync) {
        const n = body.sync.staffingUpdated;
        setNotice(`Saved. ${n} upcoming shift${n === 1 ? '' : 's'} updated.`);
      }
      onSaved();
    } catch {
      setError('Could not save the staffing rules');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {draft.length === 0 && (
        <p className="font-mono text-xs text-white/40">
          No rules yet — every shift needs {fallback}.
        </p>
      )}

      <ol className="space-y-2">
        {draft.map((rule, index) => (
          <li
            key={rule.id}
            className={`space-y-2 rounded border p-3 ${
              rule.enabled ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 opacity-60'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-white/40">{index + 1}.</span>
              <input
                className={`${compactInputClass} min-w-0 flex-1`}
                value={rule.name}
                maxLength={80}
                placeholder="Rule name (optional)"
                aria-label={`Rule ${index + 1} name`}
                disabled={busy}
                onChange={(e) => update(index, { name: e.target.value })}
              />
              <label className="flex items-center gap-1.5 font-mono text-xs text-white/70">
                needs
                <input
                  type="number"
                  min={0}
                  max={MAX_STAFF_NEEDED}
                  inputMode="numeric"
                  className={`${compactInputClass} w-16`}
                  value={rule.staffNeeded}
                  disabled={busy}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 0 && n <= MAX_STAFF_NEEDED) {
                      update(index, { staffNeeded: n });
                    }
                  }}
                />
                {rule.staffNeeded === 1 ? 'person' : 'people'}
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 font-mono text-[10px] uppercase tracking-wide text-white/40">
                Days
              </span>
              {DAY_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={chipClass(rule.days.includes(d))}
                  aria-pressed={rule.days.includes(d)}
                  disabled={busy}
                  onClick={() => update(index, { days: toggle(rule.days, d) })}
                >
                  {DOW_LABELS[d]}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 font-mono text-[10px] uppercase tracking-wide text-white/40">
                Shift
              </span>
              {SYNC_LABELS.map((label) => (
                <button
                  key={label}
                  type="button"
                  className={chipClass(rule.shiftLabels.includes(label))}
                  aria-pressed={rule.shiftLabels.includes(label)}
                  disabled={busy}
                  onClick={() => update(index, { shiftLabels: toggle(rule.shiftLabels, label) })}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-white/70">
              <span className="w-20 text-[10px] uppercase tracking-wide text-white/40">Starts</span>
              from
              <input
                type="time"
                className={`${compactInputClass} w-auto min-w-[8.5rem]`}
                value={rule.startsFrom ?? ''}
                aria-label={`Rule ${index + 1} starts from`}
                disabled={busy}
                onChange={(e) => update(index, { startsFrom: e.target.value || null })}
              />
              before
              <input
                type="time"
                className={`${compactInputClass} w-auto min-w-[8.5rem]`}
                value={rule.startsBefore ?? ''}
                aria-label={`Rule ${index + 1} starts before`}
                disabled={busy}
                onChange={(e) => update(index, { startsBefore: e.target.value || null })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 font-mono text-[10px] uppercase tracking-wide text-white/40">
                Session
              </span>
              <input
                className={`${compactInputClass} w-48`}
                value={rule.titleContains ?? ''}
                maxLength={80}
                placeholder="Title contains…"
                aria-label={`Rule ${index + 1} session title contains`}
                disabled={busy}
                onChange={(e) => update(index, { titleContains: e.target.value || null })}
              />
              <input
                className={`${compactInputClass} w-48`}
                value={rule.tagsText}
                placeholder="Tags, comma-separated"
                aria-label={`Rule ${index + 1} session tags`}
                disabled={busy}
                onChange={(e) => update(index, { tagsText: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
              <span className="min-w-0 flex-1 font-mono text-[11px] text-white/50">
                {describeStaffingRule(fromDraft(rule))} → {rule.staffNeeded}
              </span>
              <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  disabled={busy}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                />
                On
              </label>
              <button
                type="button"
                className={buttonClass}
                disabled={busy || index === 0}
                title="Check this rule earlier"
                aria-label={`Move rule ${index + 1} up`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy || index === draft.length - 1}
                title="Check this rule later"
                aria-label={`Move rule ${index + 1} down`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => remove(index)}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>

      {draft.length > 0 && (
        <p className="font-mono text-xs text-white/40">Shifts no rule matches need {fallback}.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => {
            setNotice(null);
            setDraft([...draft, newRule()]);
          }}
        >
          + Add rule
        </button>
        <button
          type="button"
          className={goldButtonClass}
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save rules'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setError(null);
              setDraft(saved);
            }}
          >
            Discard changes
          </button>
        )}
      </div>

      {error && <p className="font-mono text-xs text-[var(--pyre-red)]">{error}</p>}
      {notice && <p className="font-mono text-xs text-[var(--pyre-sage)]">{notice}</p>}
    </div>
  );
}
