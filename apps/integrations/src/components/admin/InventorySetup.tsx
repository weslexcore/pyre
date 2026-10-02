// Inventory setup (/admin/inventory/setup, admins only): storage areas in
// walk order with their count schedule, and items with how they are bought
// (lot size), when to re-order, what they cost, and which areas they live in.
//
// Nothing here is ever deleted — the ledger references areas and items — so
// "remove" is retire (active=false), which drops it from the stock screen
// and keeps its history. The setup routes re-check admin on every request.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buttonClass,
  compactInputClass,
  compactSelectClass,
  goldButtonClass,
  labelClass,
} from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import {
  formatCents,
  formatQuantity,
  formatUnits,
  lotDescription,
  totalsByItem,
} from '@/lib/inventory/rules';
import type {
  InventoryAreaRow,
  InventoryCategoryRow,
  InventoryItemRow,
  InventoryOverview,
} from '@/lib/inventory/types';
import { FIELD_LIMITS } from '@/lib/inventory/validate';
import { ErrorBanner } from './ErrorBanner';
import { Chip, primaryButtonClass } from './incidentUi';
import { dialogPanelClass, INVENTORY_API, LowBadge, takeItemParam } from './inventoryUi';
import { Modal } from './Modal';

const AREAS_API = '/api/admin/inventory-areas';
const CATEGORIES_API = '/api/admin/inventory-categories';
const ITEMS_API = '/api/admin/inventory-items';
const SPOTS_API = '/api/admin/inventory-spots';

const COUNT_SCHEDULES: { days: number | null; label: string }[] = [
  { days: null, label: 'No schedule' },
  { days: 7, label: 'Weekly' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Monthly' },
];

const scheduleLabel = (days: number | null) =>
  COUNT_SCHEDULES.find((s) => s.days === days)?.label ?? `Every ${days} days`;

const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

export function InventorySetup() {
  const { data, error, loading, reload } = useCachedJson<InventoryOverview>(INVENTORY_API);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async () => {
    invalidateJson(INVENTORY_API);
    await reload();
  };

  /** Runs a write, refreshes, and reports whether it worked. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setActionError(message(e));
      return false;
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load inventory: {error}</ErrorBanner>;
  if (!data) return null;

  return (
    <div className="space-y-10">
      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      <AreasSection areas={data.areas} run={run} refresh={refresh} />
      <CategoriesSection categories={data.categories} run={run} />
      <ItemsSection data={data} refresh={refresh} />
    </div>
  );
}

function AreasSection({
  areas,
  run,
  refresh,
}: {
  areas: InventoryAreaRow[];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<InventoryAreaRow | 'new' | null>(null);
  const active = areas.filter((a) => a.active);
  const retired = areas.filter((a) => !a.active);

  // Swap walk positions with the neighbour. Positions are rewritten as
  // 1..n first so duplicate sort_orders (e.g. from an import) can't stall it.
  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      const order = [...active];
      const [moved] = order.splice(index, 1);
      order.splice(index + delta, 0, moved);
      await Promise.all(
        order.map((area, i) =>
          area.sort_order === i + 1
            ? null
            : sendJson(`${AREAS_API}?id=${area.id}`, 'PATCH', { sortOrder: i + 1 })
        )
      );
    });

  return (
    <section aria-labelledby="areas-heading">
      <div className="mb-3 flex items-center gap-3">
        <h2
          id="areas-heading"
          className="flex-1 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Storage areas — in the order you walk them
        </h2>
        <button type="button" className={goldButtonClass} onClick={() => setEditing('new')}>
          Add area
        </button>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-white/50">No areas yet. Add the places supplies are kept.</p>
      ) : (
        <ol className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {active.map((area, index) => (
            <li key={area.id} className="flex items-center gap-2 px-3 py-2.5">
              <span className="w-5 shrink-0 font-mono text-xs text-white/30">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--pyre-creme)]">{area.name}</p>
                <p className="truncate text-xs text-white/40">
                  {[scheduleLabel(area.count_every_days), area.description]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <button
                type="button"
                className={buttonClass}
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${area.name} earlier`}
              >
                ↑
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={index === active.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${area.name} later`}
              >
                ↓
              </button>
              <button type="button" className={buttonClass} onClick={() => setEditing(area)}>
                Edit
              </button>
            </li>
          ))}
        </ol>
      )}

      {retired.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-white/40 underline"
            onClick={() => setShowRetired((v) => !v)}
          >
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired
          </button>
          {showRetired && (
            <ul className="mt-2 space-y-1">
              {retired.map((area) => (
                <li key={area.id} className="flex items-center gap-2 text-sm text-white/50">
                  <span className="flex-1">{area.name}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() =>
                      run(() => sendJson(`${AREAS_API}?id=${area.id}`, 'PATCH', { active: true }))
                    }
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <AreaDialog
          area={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            // Throws to the dialog, which shows the error and stays open.
            await (editing === 'new'
              ? sendJson(AREAS_API, 'POST', body)
              : sendJson(`${AREAS_API}?id=${editing.id}`, 'PATCH', body));
            await refresh();
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function AreaDialog({
  area,
  onClose,
  onSave,
}: {
  area: InventoryAreaRow | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(area?.name ?? '');
  const [description, setDescription] = useState(area?.description ?? '');
  const [countEveryDays, setCountEveryDays] = useState<number | null>(
    area?.count_every_days ?? null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, description, countEveryDays, ...extra });
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      labelledBy="area-dialog"
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={dialogPanelClass}
    >
      <div className="mb-4 flex items-start gap-3">
        <h2 id="area-dialog" className="flex-1 text-lg text-[var(--pyre-creme)]">
          {area ? 'Edit area' : 'Add a storage area'}
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
      <label className="mb-3 block">
        <span className={labelClass}>Name</span>
        <input
          value={name}
          maxLength={FIELD_LIMITS.areaName}
          onChange={(e) => setName(e.target.value)}
          placeholder="Back closet"
          className={`${compactInputClass} w-full`}
        />
      </label>
      <label className="mb-3 block">
        <span className={labelClass}>Where it is (optional)</span>
        <input
          value={description}
          maxLength={FIELD_LIMITS.areaDescription}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Behind the laundry, top two shelves"
          className={`${compactInputClass} w-full`}
        />
      </label>
      <div className="mb-4">
        <span className={labelClass}>Count it</span>
        <div className="flex flex-wrap gap-2">
          {COUNT_SCHEDULES.map((s) => (
            <Chip
              key={s.label}
              selected={countEveryDays === s.days}
              label={s.label}
              onClick={() => setCountEveryDays(s.days)}
            />
          ))}
        </div>
      </div>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => save()}
          className={`${primaryButtonClass} flex-1`}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {area?.active && (
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() => save({ active: false })}
          >
            Retire
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * The categories the item form's drop-down offers, in display order. Small
 * enough to edit inline: add at the bottom, rename in place, nudge up or
 * down, retire (items keep showing a retired category's name).
 */
function CategoriesSection({
  categories,
  run,
}: {
  categories: InventoryCategoryRow[];
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const active = categories.filter((c) => c.active);
  const retired = categories.filter((c) => !c.active);

  const patch = (id: string, body: Record<string, unknown>) =>
    sendJson(`${CATEGORIES_API}?id=${id}`, 'PATCH', body);

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      const order = [...active];
      const [moved] = order.splice(index, 1);
      order.splice(index + delta, 0, moved);
      await Promise.all(
        order.map((c, i) => (c.sort_order === i + 1 ? null : patch(c.id, { sortOrder: i + 1 })))
      );
    });

  const add = async () => {
    if (!newName.trim()) return;
    if (await run(() => sendJson(CATEGORIES_API, 'POST', { name: newName }))) setNewName('');
  };

  const rename = async (id: string) => {
    if (!editName.trim()) return;
    if (await run(() => patch(id, { name: editName }))) setEditingId(null);
  };

  return (
    <section aria-labelledby="categories-heading">
      <h2
        id="categories-heading"
        className="mb-3 font-mono text-xs uppercase tracking-wide text-white/50"
      >
        Categories — offered when adding an item
      </h2>

      {active.length > 0 && (
        <ol className="mb-3 divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {active.map((category, index) => (
            <li key={category.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === category.id ? (
                <>
                  <input
                    value={editName}
                    maxLength={FIELD_LIMITS.categoryName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(category.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    aria-label={`Rename ${category.name}`}
                    className={`${compactInputClass} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    className={goldButtonClass}
                    disabled={!editName.trim()}
                    onClick={() => rename(category.id)}
                  >
                    Save
                  </button>
                  <button type="button" className={buttonClass} onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--pyre-creme)]">
                    {category.name}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${category.name} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={index === active.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${category.name} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => run(() => patch(category.id, { active: false }))}
                  >
                    Retire
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex gap-2">
        <input
          value={newName}
          maxLength={FIELD_LIMITS.categoryName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
          placeholder={active.length ? 'New category' : 'Linens, Cleaning, Paper goods…'}
          aria-label="New category name"
          className={`${compactInputClass} min-w-0 flex-1 sm:max-w-xs`}
        />
        <button type="button" className={goldButtonClass} disabled={!newName.trim()} onClick={add}>
          Add category
        </button>
      </div>

      {retired.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-white/40 underline"
            onClick={() => setShowRetired((v) => !v)}
          >
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired
          </button>
          {showRetired && (
            <ul className="mt-2 space-y-1">
              {retired.map((category) => (
                <li key={category.id} className="flex items-center gap-2 text-sm text-white/50">
                  <span className="flex-1">{category.name}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => run(() => patch(category.id, { active: true }))}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ItemsSection({
  data,
  refresh,
}: {
  data: InventoryOverview;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<InventoryItemRow | 'new' | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  // Arriving from the global search (?item=<id>): open that item's edit form.
  const linkedItemId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (linkedItemId.current === undefined) linkedItemId.current = takeItemParam();
    const id = linkedItemId.current;
    if (!id) return;
    const item = data.items.find((i) => i.id === id);
    if (!item) return;
    linkedItemId.current = null;
    if (!item.active) setShowRetired(true);
    setEditing(item);
  }, [data.items]);
  const totals = useMemo(() => totalsByItem(data.stock), [data.stock]);
  const areaName = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data.areas]);
  const categoryById = useMemo(
    () => new Map(data.categories.map((c) => [c.id, c])),
    [data.categories]
  );
  // Uncategorised items sort after every category.
  const categoryRank = (item: InventoryItemRow) =>
    item.category_id
      ? (categoryById.get(item.category_id)?.sort_order ?? 0)
      : Number.MAX_SAFE_INTEGER;
  const spotsByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const spot of data.spots) {
      const list = map.get(spot.item_id) ?? [];
      list.push(areaName.get(spot.area_id) ?? '?');
      map.set(spot.item_id, list);
    }
    return map;
  }, [data.spots, areaName]);

  const shown = data.items
    .filter((i) => i.active || showRetired)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        categoryRank(a) - categoryRank(b) ||
        a.name.localeCompare(b.name)
    );
  const retiredCount = data.items.filter((i) => !i.active).length;
  const hasAreas = data.areas.some((a) => a.active);

  return (
    <section aria-labelledby="items-heading">
      <div className="mb-3 flex items-center gap-3">
        <h2
          id="items-heading"
          className="flex-1 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Items
        </h2>
        <button
          type="button"
          className={goldButtonClass}
          disabled={!hasAreas}
          title={hasAreas ? undefined : 'Add a storage area first'}
          onClick={() => setEditing('new')}
        >
          Add item
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-white/50">
          {hasAreas ? 'No items yet.' : 'Add a storage area first, then the items kept there.'}
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {shown.map((item) => {
            const total = totals.get(item.id) ?? 0;
            const low = item.reorder_level != null && total <= item.reorder_level;
            return (
              <li
                key={item.id}
                className={`flex items-start gap-3 px-3 py-2.5 ${item.active ? '' : 'opacity-50'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--pyre-creme)]">{item.name}</span>
                    {item.category_id && (
                      <span className="text-xs text-white/40">
                        {categoryById.get(item.category_id)?.name}
                      </span>
                    )}
                    {!item.active && <span className="text-xs text-white/40">(retired)</span>}
                    {item.active && low && <LowBadge />}
                  </div>
                  <p className="text-xs text-white/45">
                    {[
                      `${formatUnits(total, item.unit)} on hand`,
                      lotDescription(item),
                      item.reorder_level != null &&
                        `re-order at ${formatQuantity(item.reorder_level)}${
                          item.reorder_target != null
                            ? `, fill to ${formatQuantity(item.reorder_target)}`
                            : ''
                        }`,
                      item.unit_cost_cents != null &&
                        `${formatCents(item.unit_cost_cents)}/${item.unit}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="text-xs text-white/30">
                    {(spotsByItem.get(item.id) ?? []).join(', ') || 'Not placed in any area'}
                  </p>
                </div>
                <button type="button" className={buttonClass} onClick={() => setEditing(item)}>
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {retiredCount > 0 && (
        <button
          type="button"
          className="mt-3 text-xs text-white/40 underline"
          onClick={() => setShowRetired((v) => !v)}
        >
          {showRetired ? 'Hide' : 'Show'} {retiredCount} retired
        </button>
      )}

      {editing && (
        <ItemDialog
          item={editing === 'new' ? null : editing}
          data={data}
          onClose={() => setEditing(null)}
          onChanged={refresh}
        />
      )}
    </section>
  );
}

interface ItemForm {
  name: string;
  categoryId: string;
  unit: string;
  lotSize: string;
  lotLabel: string;
  reorderLevel: string;
  reorderTarget: string;
  unitCost: string;
  vendor: string;
  vendorUrl: string;
  notes: string;
}

const formFor = (item: InventoryItemRow | null): ItemForm => ({
  name: item?.name ?? '',
  categoryId: item?.category_id ?? '',
  unit: item?.unit ?? '',
  lotSize: item ? formatQuantity(item.lot_size) : '1',
  lotLabel: item?.lot_label ?? '',
  reorderLevel: item?.reorder_level == null ? '' : formatQuantity(item.reorder_level),
  reorderTarget: item?.reorder_target == null ? '' : formatQuantity(item.reorder_target),
  unitCost: item?.unit_cost_cents == null ? '' : (item.unit_cost_cents / 100).toFixed(2),
  vendor: item?.vendor ?? '',
  vendorUrl: item?.vendor_url ?? '',
  notes: item?.notes ?? '',
});

function ItemDialog({
  item,
  data,
  onClose,
  onChanged,
}: {
  item: InventoryItemRow | null;
  data: InventoryOverview;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<ItemForm>(() => formFor(item));
  // New items only: which areas to place it in, with an opening count each.
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const activeAreas = data.areas.filter((a) => a.active);
  // Active categories, plus the item's own if it has since been retired, so
  // editing it doesn't silently drop its category.
  const categoryOptions = data.categories.filter((c) => c.active || c.id === item?.category_id);

  const set = (key: keyof ItemForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const attempt = async (action: () => Promise<unknown>, close = true) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      if (close) onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    attempt(() =>
      item
        ? sendJson(`${ITEMS_API}?id=${item.id}`, 'PATCH', form)
        : sendJson(ITEMS_API, 'POST', {
            ...form,
            spots: Object.entries(placements).map(([areaId, quantity]) => ({
              areaId,
              quantity: quantity === '' ? 0 : Number(quantity),
            })),
          })
    );

  const field = (key: keyof ItemForm, label: string, props: Record<string, unknown> = {}) => (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      <input
        value={form[key]}
        onChange={set(key)}
        className={`${compactInputClass} w-full`}
        {...props}
      />
    </label>
  );

  const unit = form.unit.trim() || 'unit';
  const itemSpots = item ? data.spots.filter((s) => s.item_id === item.id) : [];
  const unplacedAreas = activeAreas.filter((a) => !itemSpots.some((s) => s.area_id === a.id));
  const [addAreaId, setAddAreaId] = useState('');

  return (
    <Modal
      labelledBy="item-dialog"
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={dialogPanelClass}
    >
      <div className="mb-4 flex items-start gap-3">
        <h2 id="item-dialog" className="flex-1 text-lg text-[var(--pyre-creme)]">
          {item ? `Edit ${item.name}` : 'Add an item'}
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>

      <div className="space-y-3">
        {field('name', 'Name', { maxLength: FIELD_LIMITS.itemName, placeholder: 'Hand towels' })}
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className={labelClass}>Category</span>
            <select
              value={form.categoryId}
              onChange={set('categoryId')}
              className={`${compactSelectClass} w-full`}
            >
              <option value="">No category</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? '' : ' (retired)'}
                </option>
              ))}
            </select>
          </label>
          {field('unit', 'Unit', {
            maxLength: FIELD_LIMITS.unit,
            placeholder: 'towel, bottle, roll',
            'aria-describedby': 'inventory-unit-hint',
          })}
        </div>
        <p id="inventory-unit-hint" className="-mt-1 text-xs text-white/40">
          What you count on the shelf. Stock, re-order levels and cost all use this unit.
        </p>

        <fieldset className="rounded border border-white/10 p-3">
          <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
            How it's bought
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {field('lotLabel', 'Lot name', {
              maxLength: FIELD_LIMITS.lotLabel,
              placeholder: 'case',
            })}
            {field('lotSize', `${unit}s per lot`, { inputMode: 'decimal' })}
          </div>
        </fieldset>

        <fieldset className="rounded border border-white/10 p-3">
          <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
            Re-ordering
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {field('reorderLevel', 'Re-order at', { inputMode: 'decimal', placeholder: 'e.g. 10' })}
            {field('reorderTarget', 'Fill up to', { inputMode: 'decimal', placeholder: 'e.g. 36' })}
          </div>
          <p className="mt-2 text-xs text-white/40">
            Totals across every area. When stock reaches the re-order level, the item shows as Low.
          </p>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          {field('unitCost', `Cost per ${unit} ($)`, { inputMode: 'decimal', placeholder: '2.50' })}
          {field('vendor', 'Vendor', { maxLength: FIELD_LIMITS.vendor })}
        </div>
        {field('vendorUrl', 'Re-order link', {
          maxLength: FIELD_LIMITS.vendorUrl,
          placeholder: 'https://',
        })}
        {field('notes', 'Notes', { maxLength: FIELD_LIMITS.notes })}

        {!item && (
          <fieldset className="rounded border border-white/10 p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
              Where it's kept, and how many are there now
            </legend>
            <ul className="space-y-2">
              {activeAreas.map((area) => {
                const placed = area.id in placements;
                return (
                  <li key={area.id} className="flex items-center gap-2">
                    <label className="flex flex-1 items-center gap-2 text-sm text-white/80">
                      <input
                        type="checkbox"
                        checked={placed}
                        onChange={(e) =>
                          setPlacements((p) => {
                            const next = { ...p };
                            if (e.target.checked) next[area.id] = '';
                            else delete next[area.id];
                            return next;
                          })
                        }
                      />
                      {area.name}
                    </label>
                    {placed && (
                      <input
                        inputMode="decimal"
                        aria-label={`Opening count in ${area.name}`}
                        placeholder="0"
                        value={placements[area.id]}
                        onChange={(e) =>
                          setPlacements((p) => ({
                            ...p,
                            [area.id]: e.target.value.replace(/[^0-9.]/g, ''),
                          }))
                        }
                        className={`${compactInputClass} w-24`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {item && (
          <fieldset className="rounded border border-white/10 p-3">
            <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
              Kept in
            </legend>
            <ul className="space-y-2">
              {itemSpots.map((spot) => {
                const onHand =
                  data.stock.find((s) => s.item_id === spot.item_id && s.area_id === spot.area_id)
                    ?.quantity ?? 0;
                return (
                  <li key={spot.id} className="flex items-center gap-2 text-sm text-white/80">
                    <span className="flex-1">
                      {data.areas.find((a) => a.id === spot.area_id)?.name ?? '?'}
                      <span className="ml-2 text-xs text-white/40">
                        {formatUnits(onHand, item.unit)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy || onHand > 0}
                      title={onHand > 0 ? 'Move or count the stock out first' : undefined}
                      onClick={() =>
                        attempt(() => sendJson(`${SPOTS_API}?id=${spot.id}`, 'DELETE'), false)
                      }
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            {unplacedAreas.length > 0 && (
              <div className="mt-3 flex gap-2">
                <select
                  value={addAreaId}
                  onChange={(e) => setAddAreaId(e.target.value)}
                  aria-label="Add to area"
                  className={`${compactSelectClass} min-w-0 flex-1`}
                >
                  <option value="">Also keep it in…</option>
                  {unplacedAreas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !addAreaId}
                  onClick={() =>
                    attempt(async () => {
                      await sendJson(SPOTS_API, 'POST', { itemId: item.id, areaId: addAreaId });
                      setAddAreaId('');
                    }, false)
                  }
                >
                  Add
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-white/40">
              To put stock in a new spot, use Receive or Move on the stock screen.
            </p>
          </fieldset>
        )}
      </div>

      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy || !form.name.trim() || !form.unit.trim()}
          onClick={save}
          className={`${primaryButtonClass} flex-1`}
        >
          {busy ? 'Saving…' : item ? 'Save' : 'Add item'}
        </button>
        {item && (
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() =>
              attempt(() =>
                sendJson(`${ITEMS_API}?id=${item.id}`, 'PATCH', { active: !item.active })
              )
            }
          >
            {item.active ? 'Retire' : 'Restore'}
          </button>
        )}
      </div>
    </Modal>
  );
}
