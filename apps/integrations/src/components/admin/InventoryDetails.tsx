// One inventory item's details dialog, opened from its row menu on
// /admin/inventory. The Details tab is every column in one form (name,
// category, location, stock, re-order level, count schedule and
// instructions, cost, vendor, how to order); the Analytics tab is how fast it's
// used and how it has changed (InventoryHistory).
//
// inventory:manage edits; everyone else reads. Edits save themselves: a text
// box when you leave it, a drop-down when you pick, and anything pending when
// the dialog closes. Each save sends only what changed, one at a time, and
// updates Last counted.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { buttonClass, inputClass, labelClass, selectClass } from '@/components/admin/ui';
import { etStamp } from '@/lib/client/format';
import {
  COUNT_SCHEDULES,
  countEveryLabel,
  formatCents,
  formatQuantity,
  isDue,
  isLow,
  orderLink,
  parseDollars,
  parseQuantity,
} from '@/lib/inventory/rules';
import type { InventoryRow } from '@/lib/inventory/types';
import { ErrorBanner } from './ErrorBanner';
import { CategoryPicker } from './InventoryCategoryPicker';
import { InventoryHistory } from './InventoryHistory';
import { Modal, modalPanelClass } from './Modal';

const CUSTOM = 'custom';

export type DetailsTab = 'details' | 'analytics';

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

interface Draft {
  name: string;
  category: string | null;
  location: string;
  in_stock: string;
  reorder_at: string;
  /** '' = no schedule, a COUNT_SCHEDULES value, or CUSTOM. */
  schedule: string;
  custom_days: string;
  cost: string;
  vendor: string;
  how_to_order: string;
  count_instructions: string;
}

function draftOf(item: InventoryRow): Draft {
  const days = item.count_every_days;
  const preset = days != null && (COUNT_SCHEDULES as readonly number[]).includes(days);
  return {
    name: item.name,
    category: item.category,
    location: item.location ?? '',
    in_stock: formatQuantity(item.in_stock),
    reorder_at: item.reorder_at == null ? '' : formatQuantity(item.reorder_at),
    schedule: days == null ? '' : preset ? String(days) : CUSTOM,
    custom_days: days != null && !preset ? String(days) : '',
    cost: formatCents(item.unit_cost_cents).replace(/^\$/, ''),
    vendor: item.vendor ?? '',
    how_to_order: item.how_to_order ?? '',
    count_instructions: item.count_instructions ?? '',
  };
}

/** The fields that differ from the item, or an error to show. */
function changesFrom(item: InventoryRow, d: Draft): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  const name = d.name.trim();
  if (!name) return 'Give the item a name';
  if (name !== item.name) out.name = name;

  if (d.category !== item.category) out.category = d.category;
  const location = d.location.trim() || null;
  if (location !== item.location) out.location = location;

  const stock = parseQuantity(d.in_stock);
  if (stock == null) return 'In stock must be a number';
  if (stock !== item.in_stock) out.in_stock = stock;

  const reorder = d.reorder_at.trim() ? parseQuantity(d.reorder_at) : null;
  if (d.reorder_at.trim() && reorder == null) return 'Re-order at must be a number';
  if (reorder !== item.reorder_at) out.reorder_at = reorder;

  let days: number | null = null;
  if (d.schedule === CUSTOM) {
    days = Number(d.custom_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return 'Count every must be 1 to 365 days';
    }
  } else if (d.schedule) days = Number(d.schedule);
  if (days !== item.count_every_days) out.count_every_days = days;

  const cents = d.cost.trim() ? parseDollars(d.cost) : null;
  if (d.cost.trim() && cents == null) return 'Cost must be a price, like 4.50';
  if (cents !== item.unit_cost_cents) out.unit_cost_cents = cents;

  const vendor = d.vendor.trim() || null;
  if (vendor !== item.vendor) out.vendor = vendor;
  const how = d.how_to_order.trim() || null;
  if (how !== item.how_to_order) out.how_to_order = how;
  const countHow = d.count_instructions.trim() || null;
  if (countHow !== item.count_instructions) out.count_instructions = countHow;
  return out;
}

export function InventoryDetails({
  item,
  canManage,
  vendors,
  categories,
  locations,
  countedBy,
  now,
  initialTab = 'details',
  onSave,
  onDelete,
  onClose,
}: {
  item: InventoryRow;
  canManage: boolean;
  /** Vendors already in use, offered as suggestions. */
  vendors: readonly string[];
  /** Categories already in use, offered in the drop-down. */
  categories: readonly string[];
  /** Locations already in use, offered as suggestions. */
  locations: readonly string[];
  countedBy: string | null;
  now: Date;
  initialTab?: DetailsTab;
  /** Resolves to an error message, or null once saved. */
  onSave: (patch: Record<string, unknown>) => Promise<string | null>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<DetailsTab>(initialTab);
  const [draft, setDraftState] = useState<Draft>(() => draftOf(item));
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });

  // Saves run from handlers and on close, after renders the closures may not
  // have seen, so they read the latest of everything through refs. That also
  // keeps `close` stable: Modal refocuses Close whenever onClose changes,
  // which would pull focus out of the field being typed in after each save.
  const draftRef = useRef(draft);
  const itemRef = useRef(item);
  itemRef.current = item;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setDraft = useCallback((update: (d: Draft) => Draft) => {
    const next = update(draftRef.current);
    draftRef.current = next;
    setDraftState(next);
  }, []);

  // When the item changes under the form (a save landing, or an edit in the
  // table), fields still showing the old value take the new one; anything
  // mid-edit is left alone.
  const baseRef = useRef(draftOf(item));
  useEffect(() => {
    const prev = baseRef.current;
    const next = draftOf(item);
    baseRef.current = next;
    setDraft((d) => {
      const out = { ...d };
      for (const key of Object.keys(next) as (keyof Draft)[]) {
        if (d[key] === prev[key]) (out as Record<keyof Draft, unknown>)[key] = next[key];
      }
      return out;
    });
  }, [item, setDraft]);

  /** Saves whatever differs from the item. Saves queue, so they land in order. */
  const commit = useCallback((): Promise<void> => {
    if (!canManageRef.current) return queue.current;
    queue.current = queue.current.then(async () => {
      const changes = changesFrom(itemRef.current, draftRef.current);
      if (typeof changes === 'string') return setStatus({ kind: 'error', message: changes });
      if (Object.keys(changes).length === 0) return;
      setStatus({ kind: 'saving' });
      const failure = await onSaveRef.current(changes);
      setStatus(failure ? { kind: 'error', message: failure } : { kind: 'saved' });
    });
    return queue.current;
  }, []);

  const close = useCallback(() => {
    void commit();
    onCloseRef.current();
  }, [commit]);

  /** For text boxes: update as you type, save when you leave. */
  const text = (key: keyof Draft) => ({
    value: draft[key] ?? '',
    readOnly,
    onChange: (e: { target: { value: string } }) => {
      setDraft((d) => ({ ...d, [key]: e.target.value }));
      if (status.kind === 'error') setStatus({ kind: 'idle' });
    },
    onBlur: () => void commit(),
  });

  /** For drop-downs: save on pick. */
  const pick = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    void commit();
  };

  const field = (key: string) => `${id}-${key}`;
  const link = orderLink(item.how_to_order);
  const readOnly = !canManage;
  const tabClass = (on: boolean) =>
    `border-b-2 px-1 pb-2 font-mono text-xs uppercase tracking-wide ${
      on
        ? 'border-[var(--pyre-gold)] text-[var(--pyre-creme)]'
        : 'border-transparent text-white/40 hover:text-white/70'
    }`;

  return (
    <Modal
      labelledBy={`${id}-title`}
      onClose={close}
      initialFocus={closeRef}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-lg flex-col overflow-y-auto p-5`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className="truncate text-lg font-semibold text-[var(--pyre-creme)]"
          >
            {item.name}
          </h2>
          <p className="mt-1 text-xs text-white/50">
            {item.last_counted_at
              ? `Last counted ${etStamp(item.last_counted_at)}${countedBy ? ` by ${countedBy}` : ''}`
              : 'Never counted'}
            {isDue(item, now) && ' · due for a count'}
            {isLow(item) && ' · needs re-order'}
          </p>
        </div>
        <button ref={closeRef} type="button" className={buttonClass} onClick={close}>
          Close
        </button>
      </div>

      <div role="tablist" aria-label="Item" className="mb-4 flex gap-4 border-b border-white/10">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'details'}
          className={tabClass(tab === 'details')}
          onClick={() => setTab('details')}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'analytics'}
          className={tabClass(tab === 'analytics')}
          onClick={() => {
            void commit();
            setTab('analytics');
          }}
        >
          Analytics
        </button>
      </div>

      {tab === 'analytics' ? (
        <InventoryHistory item={item} now={now} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor={field('name')} className={labelClass}>
                Item
              </label>
              <input id={field('name')} {...text('name')} className={`${inputClass} w-full`} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={field('category')} className={labelClass}>
                  Category
                </label>
                {readOnly ? (
                  <input
                    id={field('category')}
                    value={draft.category ?? ''}
                    readOnly
                    placeholder="None"
                    className={`${inputClass} w-full`}
                  />
                ) : (
                  <CategoryPicker
                    id={field('category')}
                    value={draft.category}
                    categories={categories}
                    onChange={(next) => pick({ category: next })}
                    label="Category"
                    selectClassName={`${selectClass} w-full`}
                    inputClassName={`${inputClass} w-full`}
                  />
                )}
              </div>
              <div>
                <label htmlFor={field('location')} className={labelClass}>
                  Location <span className="normal-case text-white/30">(optional)</span>
                </label>
                <input
                  id={field('location')}
                  {...text('location')}
                  list={field('locations')}
                  placeholder="Where it's kept"
                  className={`${inputClass} w-full`}
                />
                <datalist id={field('locations')}>
                  {locations.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={field('stock')} className={labelClass}>
                  In stock
                </label>
                <input
                  id={field('stock')}
                  inputMode="decimal"
                  {...text('in_stock')}
                  className={`${inputClass} w-full`}
                />
              </div>
              <div>
                <label htmlFor={field('reorder')} className={labelClass}>
                  Re-order at
                </label>
                <input
                  id={field('reorder')}
                  inputMode="decimal"
                  {...text('reorder_at')}
                  placeholder="No re-order level"
                  className={`${inputClass} w-full`}
                />
              </div>
            </div>

            <div>
              <label htmlFor={field('schedule')} className={labelClass}>
                Count every
              </label>
              <div className="flex gap-2">
                <select
                  id={field('schedule')}
                  value={draft.schedule}
                  onChange={(e) => {
                    const schedule = e.target.value;
                    // A custom schedule waits for its number of days.
                    if (schedule === CUSTOM) setDraft((d) => ({ ...d, schedule }));
                    else pick({ schedule });
                  }}
                  disabled={readOnly}
                  className={`${selectClass} flex-1`}
                >
                  <option value="">No schedule</option>
                  {COUNT_SCHEDULES.map((days) => (
                    <option key={days} value={days}>
                      {countEveryLabel(days)}
                    </option>
                  ))}
                  <option value={CUSTOM}>Custom</option>
                </select>
                {draft.schedule === CUSTOM && (
                  <label className="flex items-center gap-2 text-sm text-white/60">
                    <input
                      inputMode="numeric"
                      {...text('custom_days')}
                      aria-label="Count every how many days"
                      className={`${inputClass} w-20`}
                    />
                    days
                  </label>
                )}
              </div>
            </div>

            <div>
              <label htmlFor={field('count-how')} className={labelClass}>
                Count instructions <span className="normal-case text-white/30">(optional)</span>
              </label>
              <textarea
                id={field('count-how')}
                {...text('count_instructions')}
                rows={3}
                placeholder="Shown when someone presses Due to count it, e.g. count unopened bottles only"
                className={`${inputClass} w-full`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={field('cost')} className={labelClass}>
                  Cost per unit
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-white/40">
                    $
                  </span>
                  <input
                    id={field('cost')}
                    inputMode="decimal"
                    {...text('cost')}
                    className={`${inputClass} w-full pl-6`}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={field('vendor')} className={labelClass}>
                  Vendor
                </label>
                <input
                  id={field('vendor')}
                  {...text('vendor')}
                  list={field('vendors')}
                  className={`${inputClass} w-full`}
                />
                <datalist id={field('vendors')}>
                  {vendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label htmlFor={field('how')} className={labelClass}>
                How to order
              </label>
              <textarea
                id={field('how')}
                {...text('how_to_order')}
                rows={4}
                placeholder="A link to order from, or instructions"
                className={`${inputClass} w-full`}
              />
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs text-[var(--pyre-gold)] underline"
                >
                  Open order link
                </a>
              )}
            </div>
          </div>

          {status.kind === 'error' && <ErrorBanner>{status.message}</ErrorBanner>}

          {canManage && (
            <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={onDelete}
                className="font-mono text-xs uppercase tracking-wide text-white/40 hover:text-[var(--pyre-red)]"
              >
                Delete item
              </button>
              <p
                className="font-mono text-[10px] uppercase tracking-wide text-white/40"
                aria-live="polite"
              >
                {status.kind === 'saving'
                  ? 'Saving…'
                  : status.kind === 'saved'
                    ? 'All changes saved'
                    : 'Changes save automatically'}
              </p>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
