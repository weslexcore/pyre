// The inventory changes one agent run proposed together — counts on items
// the list already has and new items for supplies it doesn't — as one table
// an admin settles in a click. Every row is edited in place (switch the item
// a count is on, change the number, rename a new item or say where it is
// kept), unticked to leave it for later, or dismissed on its own; Approve
// applies every ticked row as it stands. Each row is approved on its own, so
// one that fails (an item deleted since, a name someone has just taken)
// stays here with its error while the rest go through.

import { useEffect, useMemo, useRef, useState } from 'react';
import { compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { etStamp } from '@/lib/client/format';
import { formatQuantity } from '@/lib/inventory/rules';
import { inventoryItemHref } from '@/lib/inventory/types';
import type { PeopleNames } from '@/lib/sops/names';
import { personName } from '@/lib/sops/names';
import {
  currentPayload,
  INVENTORY_ITEM_LIMITS,
  type InventoryCountPayload,
  type InventoryCreatePayload,
  parsePayload,
  type SuggestionResultLink,
  type SuggestionView,
} from '@/lib/suggestions/types';
import { buttonClass } from '../ShiftNoteComposer';
import { CHIP_CLASS, SparkleIcon } from '../Signals';
import * as api from './client';
import {
  InventoryItemPicker,
  QuantityInput,
  recountOn,
  stockDelta,
  useInventoryOptions,
} from './editors';

type Draft = InventoryCountPayload | InventoryCreatePayload;

const cellLabel = 'font-mono text-[10px] uppercase tracking-wide';

/** A row's stored payload in editor shape, or null when it can't be read as one. */
function editable(s: SuggestionView): Draft | null {
  const parsed = parsePayload(s.kind as 'inventory.count' | 'inventory.create', currentPayload(s));
  return parsed.ok ? parsed.value : null;
}

function isCount(s: SuggestionView): boolean {
  return s.kind === 'inventory.count';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function InventoryBatch({
  suggestions,
  names,
  onChange,
  onDecided,
}: {
  /** The run's open inventory suggestions, in the order the agent sent them. */
  suggestions: SuggestionView[];
  names: PeopleNames;
  onChange: (next: SuggestionView, result?: SuggestionResultLink) => void;
  onDecided?: (next: SuggestionView) => void;
}) {
  const { items, error: loadError } = useInventoryOptions();
  // Keyed on the rows and their saved copies, not the array's identity.
  const savedKey = suggestions.map((s) => `${s.id}@${s.edited_at ?? ''}`).join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: savedKey stands for the rows
  const baselines = useMemo(
    () => Object.fromEntries(suggestions.map((s) => [s.id, editable(s)])),
    [savedKey]
  );
  const seen = useRef(baselines);
  const [drafts, setDrafts] = useState<Record<string, Draft | null>>(baselines);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(suggestions.map((s) => s.id))
  );
  const [badText, setBadText] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // A row whose saved copy changed (saved here or elsewhere) takes it as its
  // draft; the rest keep what the admin typed. Rows that left (decided) drop
  // out, and new ones come in ticked.
  useEffect(() => {
    const before = seen.current;
    seen.current = baselines;
    setDrafts((prev) => {
      const next: Record<string, Draft | null> = {};
      for (const [id, saved] of Object.entries(baselines)) {
        next[id] = id in prev && same(before[id], saved) ? prev[id] : saved;
      }
      return next;
    });
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of Object.keys(baselines)) if (prev.has(id) || !(id in before)) next.add(id);
      return next;
    });
  }, [baselines]);

  const setDraft = (id: string, next: Draft) => setDrafts((prev) => ({ ...prev, [id]: next }));
  const setValid = (id: string, valid: boolean) =>
    setBadText((prev) => {
      const next = new Set(prev);
      if (valid) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowCheck = (s: SuggestionView) => {
    if (badText.has(s.id)) return { ok: false as const, error: 'Fix the number first' };
    const parsed = parsePayload(s.kind as 'inventory.count' | 'inventory.create', drafts[s.id]);
    return parsed.ok ? { ok: true as const, value: parsed.value } : parsed;
  };

  const chosen = suggestions.filter((s) => selected.has(s.id) && s.status === 'pending');
  const invalid = chosen.filter((s) => !rowCheck(s).ok);
  const dirty = suggestions.filter((s) => drafts[s.id] && !same(drafts[s.id], baselines[s.id]));
  const all = chosen.length === suggestions.length;

  const settle = (decided: SuggestionView, result?: SuggestionResultLink) => {
    const view = {
      ...decided,
      sourceChanged: suggestions.find((s) => s.id === decided.id)?.sourceChanged ?? false,
    };
    onChange(view, result);
    if (view.status === 'approved' || view.status === 'dismissed') onDecided?.(view);
  };

  const approve = async () => {
    const batch = chosen.flatMap((s) => {
      const check = rowCheck(s);
      return check.ok ? [{ id: s.id, payload: check.value }] : [];
    });
    if (batch.length === 0) return;
    setBusy(true);
    setErrors({});
    try {
      const decisions = await api.approveMany(batch);
      const failed: Record<string, string> = {};
      for (const d of decisions) {
        if (d.ok) settle(d.suggestion, d.result);
        else {
          failed[d.id] = d.error;
          if (d.suggestion) settle(d.suggestion);
        }
      }
      setErrors(failed);
      // New items are on the list now; the pickers read it afresh.
      api.forgetInventoryOptions();
    } catch (e) {
      setErrors(
        Object.fromEntries(
          batch.map((b) => [b.id, e instanceof Error ? e.message : 'Something went wrong'])
        )
      );
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (id: string) => {
    setBusy(true);
    try {
      const { suggestion } = await api.dismiss(id);
      settle(suggestion);
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [id]: e instanceof Error ? e.message : 'Could not dismiss it',
      }));
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    setBusy(true);
    try {
      for (const s of dirty) {
        const check = rowCheck(s);
        if (!check.ok) continue;
        const { suggestion } = await api.saveEdit(s.id, check.value);
        settle(suggestion);
      }
    } catch (e) {
      setErrors({ batch: e instanceof Error ? e.message : 'Could not save the edits' });
    } finally {
      setBusy(false);
    }
  };

  // Every row of one run reads from the same note, so one credit line covers them.
  const credit = suggestions
    .map((s) => drafts[s.id])
    .find((d): d is Draft => !!d?.countedBy && d.inStock !== null);
  const counts = suggestions.filter(isCount).length;
  const additions = suggestions.length - counts;

  return (
    <div className="space-y-3 rounded border border-[var(--pyre-gold)]/25 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SparkleIcon className="text-[var(--pyre-gold)]" />
        <span className={`${CHIP_CLASS} border-emerald-400/40 bg-emerald-400/10 text-emerald-300`}>
          Inventory update
        </span>
        <span className="text-xs text-white/70">
          {[
            counts > 0 && `${counts} count${counts === 1 ? '' : 's'}`,
            additions > 0 && `${additions} new item${additions === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' and ')}
        </span>
      </div>

      <ul className="divide-y divide-white/10 rounded border border-white/10">
        {suggestions.map((s) => {
          const draft = drafts[s.id];
          const applying = s.status === 'applying';
          const error = errors[s.id] ?? s.error;
          const check = rowCheck(s);
          return (
            <li key={s.id} className="space-y-1.5 px-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Include in the approval"
                  checked={selected.has(s.id)}
                  disabled={busy || applying}
                  onChange={() => toggle(s.id)}
                />
                {draft === null ? (
                  <span className="font-mono text-[10px] text-[var(--pyre-red)]">
                    This suggestion’s saved form can’t be read; dismiss it.
                  </span>
                ) : isCount(s) ? (
                  <CountRow
                    id={s.id}
                    value={draft as InventoryCountPayload}
                    items={items}
                    disabled={busy || applying}
                    onChange={(next) => setDraft(s.id, next)}
                    onValidity={(valid) => setValid(s.id, valid)}
                  />
                ) : (
                  <CreateRow
                    id={s.id}
                    value={draft as InventoryCreatePayload}
                    disabled={busy || applying}
                    onChange={(next) => setDraft(s.id, next)}
                    onValidity={(valid) => setValid(s.id, valid)}
                  />
                )}
                <button
                  type="button"
                  className="ml-auto font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white"
                  disabled={busy || applying}
                  onClick={() => void dismiss(s.id)}
                >
                  Dismiss
                </button>
              </div>
              {s.rationale && (
                <p className="pl-6 text-[11px] italic text-white/50">{s.rationale}</p>
              )}
              {!check.ok && selected.has(s.id) && draft && (
                <p className="pl-6 font-mono text-[10px] text-[var(--pyre-red)]">{check.error}</p>
              )}
              {error && (
                <p className="ml-6 rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-2 py-1 font-mono text-[10px] text-[var(--pyre-red)]">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {loadError && (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">
          Couldn’t load the inventory to switch items ({loadError}).
        </p>
      )}
      {errors.batch && (
        <p className="font-mono text-[10px] text-[var(--pyre-red)]">{errors.batch}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={goldButtonClass}
          disabled={busy || chosen.length === 0 || invalid.length > 0}
          onClick={() => void approve()}
        >
          {busy
            ? 'Approving…'
            : all
              ? `Approve all ${chosen.length}`
              : `Approve ${chosen.length} selected`}
        </button>
        {dirty.length > 0 && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void saveEdits()}
          >
            Save edits for later
          </button>
        )}
        {invalid.length > 0 && (
          <span className="font-mono text-[10px] text-[var(--pyre-red)]">
            {invalid.length === 1 ? 'One row needs' : `${invalid.length} rows need`} fixing or
            unticking first.
          </span>
        )}
      </div>
      <p className="font-mono text-[10px] text-white/40">
        {credit?.countedBy
          ? `Counts are recorded as ${personName(credit.countedBy, names)}'s${
              credit.countedAt ? `, on ${etStamp(credit.countedAt)}` : ''
            }, with a link back to where they were read.`
          : 'Counts link back to where they were read.'}
        {additions > 0 && ' New items are added as yours.'} Unticked rows stay here for later.
      </p>
    </div>
  );
}

function CountRow({
  id,
  value,
  items,
  disabled,
  onChange,
  onValidity,
}: {
  id: string;
  value: InventoryCountPayload;
  items: ReturnType<typeof useInventoryOptions>['items'];
  disabled: boolean;
  onChange: (next: InventoryCountPayload) => void;
  onValidity: (valid: boolean) => void;
}) {
  const delta = stockDelta(value.previousInStock, value.inStock);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className={`${cellLabel} text-white/40`}>Count</span>
      <InventoryItemPicker
        id={`batch-${id}-item`}
        className="min-w-0 max-w-full flex-1 sm:max-w-64"
        value={value}
        items={items}
        disabled={disabled}
        onPick={(item) => onChange(recountOn(value, item))}
      />
      <span className="font-mono text-[10px] text-white/40">
        <a
          href={inventoryItemHref(value.itemId)}
          className="underline decoration-white/20 hover:text-white"
        >
          {value.previousInStock === null
            ? 'on record'
            : `${formatQuantity(value.previousInStock)} on record`}
        </a>
        {' →'}
      </span>
      <QuantityInput
        id={`batch-${id}-count`}
        label="In stock"
        className="w-20"
        value={value.inStock}
        disabled={disabled}
        onValidity={onValidity}
        onChange={(next) => {
          // A typed number is what is on hand: a set, not a change.
          if (next !== null) onChange({ ...value, inStock: next, change: null });
          else onValidity(false);
        }}
      />
      {delta && <span className="font-mono text-xs text-white/60">{delta}</span>}
      {!delta && value.inStock === value.previousInStock && (
        <span className="font-mono text-xs text-white/40">same, recounted</span>
      )}
    </div>
  );
}

function CreateRow({
  id,
  value,
  disabled,
  onChange,
  onValidity,
}: {
  id: string;
  value: InventoryCreatePayload;
  disabled: boolean;
  onChange: (next: InventoryCreatePayload) => void;
  onValidity: (valid: boolean) => void;
}) {
  const set = (patch: Partial<InventoryCreatePayload>) => onChange({ ...value, ...patch });
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className={`${cellLabel} text-emerald-300/80`}>New item</span>
      <input
        aria-label="Name"
        className={`${compactInputClass} min-w-0 flex-1 sm:max-w-64`}
        value={value.name}
        maxLength={INVENTORY_ITEM_LIMITS.name}
        disabled={disabled}
        onChange={(e) => set({ name: e.target.value })}
      />
      <input
        aria-label="Category"
        placeholder="category"
        className={`${compactInputClass} w-28`}
        value={value.category ?? ''}
        maxLength={INVENTORY_ITEM_LIMITS.category}
        disabled={disabled}
        onChange={(e) => set({ category: e.target.value })}
      />
      <input
        aria-label="Kept at"
        placeholder="kept at"
        className={`${compactInputClass} w-28`}
        value={value.location ?? ''}
        maxLength={INVENTORY_ITEM_LIMITS.location}
        disabled={disabled}
        onChange={(e) => set({ location: e.target.value })}
      />
      <QuantityInput
        id={`batch-${id}-count`}
        label="In stock"
        placeholder="count"
        className="w-20"
        value={value.inStock}
        disabled={disabled}
        onValidity={onValidity}
        onChange={(inStock) => set({ inStock })}
      />
    </div>
  );
}
