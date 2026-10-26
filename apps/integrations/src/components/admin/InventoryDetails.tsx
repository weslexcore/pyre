// One inventory item's details dialog, opened from its row menu on
// /admin/inventory: every column in one form (name, stock, re-order level,
// count schedule, cost, vendor, how to order) plus who last counted it.
// inventory:manage edits and saves; everyone else reads. Saving sends only what changed,
// and any saved change updates Last counted.

import { useId, useRef, useState } from 'react';
import {
  buttonClass,
  goldButtonClass,
  inputClass,
  labelClass,
  selectClass,
} from '@/components/admin/ui';
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
import { Modal, modalPanelClass } from './Modal';

const CUSTOM = 'custom';

interface Draft {
  name: string;
  category: string | null;
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
  countedBy,
  now,
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
  countedBy: string | null;
  now: Date;
  /** Resolves to an error message, or null once saved. */
  onSave: (patch: Record<string, unknown>) => Promise<string | null>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [key]: e.target.value }));
    setError(null);
  };

  const submit = async () => {
    const changes = changesFrom(item, draft);
    if (typeof changes === 'string') return setError(changes);
    if (Object.keys(changes).length === 0) return onClose();
    setBusy(true);
    const failure = await onSave(changes);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  };

  const field = (key: string) => `${id}-${key}`;
  const link = orderLink(item.how_to_order);
  const readOnly = !canManage;

  return (
    <Modal
      labelledBy={`${id}-title`}
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-lg flex-col overflow-y-auto p-5`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
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
        <button ref={closeRef} type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label htmlFor={field('name')} className={labelClass}>
              Item
            </label>
            <input
              id={field('name')}
              value={draft.name}
              onChange={set('name')}
              readOnly={readOnly}
              className={`${inputClass} w-full`}
            />
          </div>

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
                onChange={(next) => {
                  setDraft((d) => ({ ...d, category: next }));
                  setError(null);
                }}
                label="Category"
                selectClassName={`${selectClass} w-full`}
                inputClassName={`${inputClass} w-full`}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={field('stock')} className={labelClass}>
                In stock
              </label>
              <input
                id={field('stock')}
                inputMode="decimal"
                value={draft.in_stock}
                onChange={set('in_stock')}
                readOnly={readOnly}
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
                value={draft.reorder_at}
                onChange={set('reorder_at')}
                readOnly={readOnly}
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
                onChange={set('schedule')}
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
                    value={draft.custom_days}
                    onChange={set('custom_days')}
                    readOnly={readOnly}
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
              value={draft.count_instructions}
              onChange={set('count_instructions')}
              readOnly={readOnly}
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
                  value={draft.cost}
                  onChange={set('cost')}
                  readOnly={readOnly}
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
                value={draft.vendor}
                onChange={set('vendor')}
                readOnly={readOnly}
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
              value={draft.how_to_order}
              onChange={set('how_to_order')}
              readOnly={readOnly}
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
        </fieldset>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        {canManage && (
          <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={onDelete}
              className="font-mono text-xs uppercase tracking-wide text-white/40 hover:text-[var(--pyre-red)]"
            >
              Delete item
            </button>
            <div className="flex gap-2">
              <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={goldButtonClass} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
