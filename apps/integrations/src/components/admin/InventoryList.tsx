// The inventory list (/admin/inventory): one spreadsheet-style table, a row
// per item. Click a cell to edit it; Enter or clicking away saves, Escape
// cancels. Headers sort, the toolbar searches and filters (due for a count,
// needs re-ordering, by category). The setup columns (category, location,
// re-order level, schedule, cost, vendor, how to order) stay hidden until
// "Show all fields" is ticked, so the everyday view is just what to count.
// Usage (use per week, when it runs out) shows there too, and always in an
// item's Analytics tab.
//
// Anyone with the page can count: set the In stock number (Enter on an
// unchanged number confirms it). Any edit to a row stamps Last counted with
// who made it and when. inventory:manage (or an admin holding the page)
// edits every other column, adds items, sets them aside as inactive
// (seasonal ones, say: off the list, never due or low, under the Inactive
// filter until they're back), and deletes them.
// /api/admin/inventory is the security boundary; this island only offers
// what the viewer may do.

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buttonClass,
  compactInputClass,
  compactSelectClass,
  goldButtonClass,
} from '@/components/admin/ui';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etStamp } from '@/lib/client/format';
import {
  COUNT_SCHEDULES,
  countEveryLabel,
  daysLeft,
  distinctValues,
  formatCents,
  formatDaysLeft,
  formatPerWeek,
  formatQuantity,
  type InventoryFilter,
  isDue,
  isLow,
  type ListQuery,
  listItems,
  orderLink,
  parseDollars,
  parseQuantity,
  type SortKey,
  UNCATEGORISED,
} from '@/lib/inventory/rules';
import { INVENTORY_API, type InventoryResponse, type InventoryRow } from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { CategoryPicker } from './InventoryCategoryPicker';
import { type DetailsTab, InventoryDetails } from './InventoryDetails';
import { Chip } from './incidentUi';
import { Modal, modalPanelClass } from './Modal';

// The viewer's last sort, so the list opens the way they left it.
const SORT_KEY = 'pyre-inventory-sort';

function readSortPref(): Pick<ListQuery, 'sort' | 'desc'> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null');
    return saved && typeof saved.sort === 'string'
      ? { sort: saved.sort, desc: !!saved.desc }
      : null;
  } catch {
    return null;
  }
}

function writeSortPref(sort: SortKey, desc: boolean): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify({ sort, desc }));
  } catch {
    // Private mode etc. — sorting still works for the session.
  }
}

/** `?filter=` and `?item=` from a link (low-stock alert, global search), read once and dropped. */
function takeLinkParams(): { filter: InventoryFilter | null; item: string | null } {
  if (typeof window === 'undefined') return { filter: null, item: null };
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('filter');
  const filter = raw === 'due' || raw === 'reorder' || raw === 'inactive' ? raw : null;
  const item = url.searchParams.get('item');
  if (!raw && !item) return { filter, item };
  url.searchParams.delete('filter');
  url.searchParams.delete('item');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return { filter, item };
}

type Patch = Partial<Record<keyof InventoryRow, unknown>>;

type ColumnKey = SortKey | 'how_to_order';

interface Column {
  key: ColumnKey;
  label: string;
  /** Starting width in px; the viewer can drag it wider or narrower. */
  width: number;
  /** A setup column, shown only with "Show all fields". */
  setup?: boolean;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Item', width: 240 },
  { key: 'category', label: 'Category', width: 160, setup: true },
  { key: 'location', label: 'Location', width: 160, setup: true },
  { key: 'in_stock', label: 'In stock', width: 96, className: 'text-right' },
  { key: 'reorder_at', label: 'Re-order at', width: 112, className: 'text-right', setup: true },
  { key: 'last_counted_at', label: 'Last counted', width: 220 },
  { key: 'usage', label: 'Use / week', width: 112, className: 'text-right', setup: true },
  { key: 'days_left', label: 'Runs out', width: 112, setup: true },
  { key: 'count_every_days', label: 'Count every', width: 170, setup: true },
  {
    key: 'unit_cost_cents',
    label: 'Cost / unit',
    width: 112,
    className: 'text-right',
    setup: true,
  },
  { key: 'vendor', label: 'Vendor', width: 160, setup: true },
  { key: 'how_to_order', label: 'How to order', width: 300, setup: true },
];

// Whether the viewer last had "Show all fields" ticked.
const SHOW_ALL_KEY = 'pyre-inventory-show-all';

function readShowAllPref(): boolean {
  try {
    return localStorage.getItem(SHOW_ALL_KEY) === '1';
  } catch {
    return false;
  }
}

function writeShowAllPref(on: boolean): void {
  try {
    localStorage.setItem(SHOW_ALL_KEY, on ? '1' : '0');
  } catch {
    // Private mode etc. — the toggle still works for the session.
  }
}

const ACTIONS_WIDTH = 72;
const MIN_WIDTH = 60;
const MAX_WIDTH = 800;
const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));

// The viewer's column widths, so the list opens the way they left it.
const WIDTHS_KEY = 'pyre-inventory-widths';

type Widths = Partial<Record<ColumnKey, number>>;

function readWidthsPref(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}');
    const out: Widths = {};
    for (const c of COLUMNS) {
      if (typeof saved?.[c.key] === 'number') out[c.key] = clampWidth(saved[c.key]);
    }
    return out;
  } catch {
    return {};
  }
}

function writeWidthsPref(widths: Widths): void {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Private mode etc. — resizing still works for the session.
  }
}

const chipClass = 'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide';

const cellClass = 'border-b border-white/5 px-2 py-1 align-middle';
const readClass =
  'block w-full min-h-[2rem] truncate rounded px-1.5 py-1 text-left hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/30';
const editClass = `${compactInputClass} w-full`;

export function InventoryList() {
  const { data, error, loading, setData } = useCachedJson<InventoryResponse>(INVENTORY_API);
  const [query, setQuery] = useState<ListQuery>({
    search: '',
    filter: 'all',
    category: '',
    sort: 'name',
    desc: false,
  });
  const [showAll, setShowAll] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The item whose details dialog is open, and the tab it opened on.
  const [details, setDetails] = useState<{ id: string; tab: DetailsTab } | null>(null);
  const detailsId = details?.id ?? null;
  const setDetailsId = (id: string | null, tab: DetailsTab = 'details') =>
    setDetails(id ? { id, tab } : null);
  // The item whose ordering instructions are open.
  const [orderId, setOrderId] = useState<string | null>(null);
  // The item whose count dialog (from its Due chip) is open.
  const [countId, setCountId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [widths, setWidths] = useState<Widths>({});
  const widthOf = (c: Column) => widths[c.key] ?? c.width;
  const resize = (key: ColumnKey, width: number | null, persist: boolean) =>
    setWidths((prev) => {
      const next = { ...prev };
      if (width == null) delete next[key];
      else next[key] = clampWidth(width);
      if (persist) writeWidthsPref(next);
      return next;
    });
  // Re-read once a minute so a daily count turns due at midnight on an open tab.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Read after mount: the island is server-rendered, where there is no URL or storage.
  useEffect(() => {
    const saved = readSortPref();
    setWidths(readWidthsPref());
    setShowAll(readShowAllPref());
    const link = takeLinkParams();
    setQuery((q) => ({ ...q, ...saved, ...(link.filter ? { filter: link.filter } : {}) }));
    if (link.item) setHighlight(link.item);
  }, []);

  useEffect(() => {
    if (!highlight || !data) return;
    // A link to an inactive item (from global search) opens the Inactive list.
    if (data.items.find((i) => i.id === highlight)?.active === false) {
      setQuery((q) => (q.filter === 'inactive' ? q : { ...q, filter: 'inactive' }));
    }
    document.getElementById(`item-${highlight}`)?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight, data]);

  const items = data?.items ?? [];
  const vendors = useMemo(() => distinctValues(items, 'vendor'), [items]);
  const categories = useMemo(() => distinctValues(items, 'category'), [items]);
  const locations = useMemo(() => distinctValues(items, 'location'), [items]);
  const columns = COLUMNS.filter((c) => showAll || !c.setup);
  const shown = new Set(columns.map((c) => c.key));
  // The column that grows to fill a wide screen: the last one showing, so
  // every column before it (the item name included) keeps the width it was
  // dragged to.
  const stretchKey: ColumnKey = columns[columns.length - 1].key;
  // A sort on a column that's now hidden would order the list by something
  // you can't see; fall back to the name.
  const listQuery: ListQuery =
    shown.has(query.sort) || query.sort === 'due' ? query : { ...query, sort: 'name', desc: false };
  const rows = listItems(items, listQuery, now);
  const dueCount = items.filter((i) => isDue(i, now)).length;
  const lowCount = items.filter(isLow).length;
  const activeCount = items.filter((i) => i.active).length;

  const sortBy = (key: SortKey) => {
    setQuery((q) => {
      const desc = q.sort === key ? !q.desc : false;
      writeSortPref(key, desc);
      return { ...q, sort: key, desc };
    });
  };

  const replaceRow = (item: InventoryRow, people?: Record<string, string>) =>
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.some((i) => i.id === item.id)
              ? prev.items.map((i) => (i.id === item.id ? item : i))
              : [...prev.items, item],
            people: { ...prev.people, ...people },
          }
        : prev
    );

  // The details dialog shows its own error instead of the banner above the list.
  const saveDetails = async (id: string, patch: Patch): Promise<string | null> => {
    try {
      const res = await sendJson<{ item: InventoryRow; people: Record<string, string> }>(
        `${INVENTORY_API}?id=${id}`,
        'PATCH',
        patch
      );
      replaceRow(res.item, res.people);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  const save = async (id: string, patch: Patch): Promise<boolean> => {
    setSaveError(null);
    try {
      const res = await sendJson<{ item: InventoryRow; people: Record<string, string> }>(
        `${INVENTORY_API}?id=${id}`,
        'PATCH',
        patch
      );
      replaceRow(res.item, res.people);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const add = async (name: string): Promise<boolean> => {
    setSaveError(null);
    try {
      const res = await sendJson<{ item: InventoryRow }>(INVENTORY_API, 'POST', { name });
      replaceRow(res.item);
      setAdding(false);
      setQuery((q) => (q.filter === 'inactive' ? { ...q, filter: 'all' } : q));
      setHighlight(res.item.id);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const remove = async (item: InventoryRow) => {
    const ask = item.active
      ? `Delete ${item.name} and its history? This can't be undone. To set it aside for now (a seasonal item, say), mark it inactive instead.`
      : `Delete ${item.name} and its history? This can't be undone.`;
    if (!window.confirm(ask)) return;
    setSaveError(null);
    try {
      await sendJson(`${INVENTORY_API}?id=${item.id}`, 'DELETE');
      setDetails((open) => (open?.id === item.id ? null : open));
      setData((prev) =>
        prev ? { ...prev, items: prev.items.filter((i) => i.id !== item.id) } : prev
      );
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load inventory: {error}</ErrorBanner>;
  if (!data) return null;
  const { canManage, people } = data;
  const detailsItem = detailsId ? items.find((i) => i.id === detailsId) : undefined;
  const orderItem = orderId ? items.find((i) => i.id === orderId) : undefined;
  const countItem = countId ? items.find((i) => i.id === countId) : undefined;

  const filters: { key: InventoryFilter; label: string }[] = [
    { key: 'all', label: `All (${activeCount})` },
    { key: 'due', label: `Due for a count (${dueCount})` },
    { key: 'reorder', label: `Needs re-order (${lowCount})` },
    // Only once something has been set aside (or while it's the filter).
    ...(activeCount < items.length || query.filter === 'inactive'
      ? [{ key: 'inactive' as const, label: `Inactive (${items.length - activeCount})` }]
      : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query.search}
          onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))}
          placeholder="Search items, categories, locations, vendors"
          aria-label="Search inventory"
          className={`${compactInputClass} w-full sm:w-64`}
        />
        {filters.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={query.filter === f.key}
            onClick={() => setQuery((q) => ({ ...q, filter: f.key }))}
          />
        ))}
        {categories.length > 0 && (
          <select
            value={query.category}
            onChange={(e) => setQuery((q) => ({ ...q, category: e.target.value }))}
            aria-label="Filter by category"
            className={compactSelectClass}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={UNCATEGORISED}>No category</option>
          </select>
        )}
        <label className="flex cursor-pointer items-center gap-2 font-mono text-xs uppercase tracking-wide text-white/60 sm:ml-auto">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              writeShowAllPref(e.target.checked);
            }}
            className="h-4 w-4 accent-[var(--pyre-gold)]"
          />
          Show all fields
        </label>
        {canManage && (
          <button
            type="button"
            className={goldButtonClass}
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add item
          </button>
        )}
      </div>

      {saveError && <ErrorBanner>{saveError}</ErrorBanner>}

      {countItem && (
        <CountDialog
          key={countItem.id}
          item={countItem}
          onSave={(n) => saveDetails(countItem.id, { in_stock: n })}
          onClose={() => setCountId(null)}
        />
      )}

      {orderItem && (
        <OrderInstructions
          item={orderItem}
          onEdit={
            canManage
              ? () => {
                  setOrderId(null);
                  setDetailsId(orderItem.id);
                }
              : undefined
          }
          onClose={() => setOrderId(null)}
        />
      )}

      {detailsItem && (
        <InventoryDetails
          key={detailsItem.id}
          item={detailsItem}
          canManage={canManage}
          vendors={vendors}
          categories={categories}
          locations={locations}
          initialTab={details?.tab}
          countedBy={
            detailsItem.last_counted_by ? personName(detailsItem.last_counted_by, people) : null
          }
          now={now}
          onSave={(patch) => saveDetails(detailsItem.id, patch)}
          onDelete={() => void remove(detailsItem)}
          onToggleActive={() => saveDetails(detailsItem.id, { active: !detailsItem.active })}
          onClose={() => setDetailsId(null)}
        />
      )}

      <div className="overflow-x-auto rounded border border-white/10">
        <table
          className="w-full table-fixed border-collapse text-sm text-[var(--pyre-creme)]"
          // Fills the space it's given; past that, the columns' widths win and
          // the table scrolls sideways.
          style={{ minWidth: columns.reduce((sum, c) => sum + widthOf(c), ACTIONS_WIDTH) }}
        >
          <colgroup>
            {columns.map((c) => (
              // The stretch column takes whatever room the others leave.
              <col key={c.key} style={c.key === stretchKey ? undefined : { width: widthOf(c) }} />
            ))}
            <col style={{ width: ACTIONS_WIDTH }} />
          </colgroup>
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03] text-left font-mono text-[10px] uppercase tracking-wide text-white/50">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-2 py-2 font-normal ${c.className ?? ''} ${c.key === 'name' ? 'sticky left-0 z-10 bg-[var(--pyre-black)]' : 'relative'}`}
                  aria-sort={
                    listQuery.sort === c.key
                      ? listQuery.desc
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  {c.key === 'how_to_order' ? (
                    c.label
                  ) : (
                    <button
                      type="button"
                      onClick={() => sortBy(c.key as SortKey)}
                      className="uppercase tracking-wide hover:text-white"
                    >
                      {c.label}
                      {listQuery.sort === c.key ? (listQuery.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  )}
                  <ResizeHandle
                    label={c.label}
                    width={widthOf(c)}
                    onResize={(w, persist) => resize(c.key, w, persist)}
                    onReset={() => resize(c.key, null, true)}
                  />
                </th>
              ))}
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <NewRow span={columns.length} onAdd={add} onCancel={() => setAdding(false)} />
            )}
            {rows.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                now={now}
                canManage={canManage}
                shown={shown}
                categories={categories}
                locations={locations}
                countedBy={item.last_counted_by ? personName(item.last_counted_by, people) : null}
                highlighted={highlight === item.id}
                onSave={(patch) => save(item.id, patch)}
                onDetails={() => setDetailsId(item.id)}
                onAnalytics={() => setDetailsId(item.id, 'analytics')}
                onShowOrder={() => setOrderId(item.id)}
                onCount={() => setCountId(item.id)}
                onDelete={() => remove(item)}
                onToggleActive={() => save(item.id, { active: !item.active })}
              />
            ))}
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-white/50">
                  {items.length === 0
                    ? canManage
                      ? 'No items yet. Add the first one.'
                      : 'No items yet. Someone who manages inventory can add them.'
                    : query.filter === 'inactive'
                      ? 'No inactive items.'
                      : 'Nothing matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
        Click a cell to edit, or open an item's menu for all its details and analytics. Any edit
        updates Last counted. Shelf matches? Click In stock and press Enter.
        {!canManage && ' Changing other columns needs the inventory manage permission.'}
      </p>
    </div>
  );
}

function NewRow({
  span,
  onAdd,
  onCancel,
}: {
  /** How many columns are showing; the row spans the rest after the name. */
  span: number;
  onAdd: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return onCancel();
    setBusy(true);
    if (!(await onAdd(name))) setBusy(false);
  };
  return (
    <tr className="bg-white/[0.04]">
      <td className={`${cellClass} sticky left-0 z-10 bg-[var(--pyre-black)]`}>
        <input
          // biome-ignore lint/a11y/noAutofocus: the row exists only to take this name
          autoFocus
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="New item name"
          aria-label="New item name"
          className={editClass}
        />
      </td>
      <td colSpan={span} className={`${cellClass} text-white/50`}>
        <span className="mr-3 text-xs">Enter to add, then fill in the rest.</span>
        <button type="button" className={buttonClass} onClick={() => void submit()} disabled={busy}>
          Add
        </button>{' '}
        <button type="button" className={buttonClass} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

function ItemRow({
  item,
  now,
  canManage,
  shown,
  categories,
  locations,
  countedBy,
  highlighted,
  onSave,
  onDetails,
  onAnalytics,
  onShowOrder,
  onCount,
  onDelete,
  onToggleActive,
}: {
  item: InventoryRow;
  now: Date;
  canManage: boolean;
  /** The columns showing. */
  shown: ReadonlySet<ColumnKey>;
  categories: readonly string[];
  locations: readonly string[];
  countedBy: string | null;
  highlighted: boolean;
  onSave: (patch: Patch) => Promise<boolean>;
  onDetails: () => void;
  onAnalytics: () => void;
  onShowOrder: () => void;
  onCount: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const left = daysLeft(item);
  const due = isDue(item, now);
  const low = isLow(item);
  const link = orderLink(item.how_to_order);
  const rowTone = `${highlighted ? 'bg-[var(--pyre-gold)]/10' : 'hover:bg-white/[0.02]'} ${
    item.active ? '' : 'text-white/50'
  }`;

  return (
    <tr id={`item-${item.id}`} className={`transition-colors ${rowTone}`}>
      <td className={`${cellClass} sticky left-0 z-10 bg-[var(--pyre-black)] font-medium`}>
        <TextCell
          value={item.name}
          label="Item name"
          editable={canManage}
          onSave={(v) => (v ? onSave({ name: v }) : Promise.resolve(false))}
        />
        {(due || low || !item.active) && (
          <div className="flex flex-wrap items-center gap-1.5 px-1.5 pb-1">
            {!item.active && (
              <span className={`${chipClass} border-white/20 text-white/50`}>Inactive</span>
            )}
            {due && (
              <button
                type="button"
                onClick={onCount}
                className={`${chipClass} border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] hover:bg-[var(--pyre-gold)]/20`}
                title={item.count_instructions || item.location ? 'How to count it' : 'Count it'}
              >
                Due{item.count_instructions || item.location ? ' · how to count' : ''}
              </button>
            )}
            {low && (
              <ReorderChip
                link={link}
                hasInstructions={!!item.how_to_order?.trim()}
                onShowOrder={onShowOrder}
                onDetails={onDetails}
              />
            )}
          </div>
        )}
      </td>
      {shown.has('category') && (
        <td className={cellClass}>
          {canManage ? (
            <CategoryPicker
              value={item.category}
              categories={categories}
              onChange={(next) => void onSave({ category: next })}
              label={`Category for ${item.name}`}
              selectClassName={`${compactSelectClass} w-full border-transparent bg-transparent hover:border-white/10`}
              inputClassName={editClass}
            />
          ) : (
            <span className="block truncate px-1.5 py-1 text-white/70">{item.category}</span>
          )}
        </td>
      )}
      {shown.has('location') && (
        <td className={cellClass}>
          {canManage ? (
            <CategoryPicker
              kind="location"
              value={item.location}
              categories={locations}
              onChange={(next) => void onSave({ location: next })}
              label={`Location of ${item.name}`}
              selectClassName={`${compactSelectClass} w-full border-transparent bg-transparent hover:border-white/10`}
              inputClassName={editClass}
            />
          ) : (
            <span className="block truncate px-1.5 py-1 text-white/70">{item.location}</span>
          )}
        </td>
      )}
      <td className={`${cellClass} text-right`}>
        <TextCell
          value={formatQuantity(item.in_stock)}
          label={`In stock for ${item.name}`}
          editable
          numeric
          confirmUnchanged
          tone={low ? 'text-[var(--pyre-red)]' : undefined}
          onSave={(v) => {
            const n = parseQuantity(v);
            return n == null ? Promise.resolve(false) : onSave({ in_stock: n });
          }}
        />
      </td>
      {shown.has('reorder_at') && (
        <td className={`${cellClass} text-right`}>
          <TextCell
            value={item.reorder_at == null ? '' : formatQuantity(item.reorder_at)}
            label={`Re-order level for ${item.name}`}
            editable={canManage}
            numeric
            onSave={(v) => {
              if (!v) return onSave({ reorder_at: null });
              const n = parseQuantity(v);
              return n == null ? Promise.resolve(false) : onSave({ reorder_at: n });
            }}
          />
        </td>
      )}
      <td className={`${cellClass} truncate whitespace-nowrap px-3.5 text-white/70`}>
        {item.last_counted_at ? (
          <>
            {etStamp(item.last_counted_at)}
            {countedBy && <span className="text-white/40"> · {countedBy}</span>}
          </>
        ) : (
          <span className="text-white/30">Never</span>
        )}
      </td>
      {shown.has('usage') && (
        <td className={`${cellClass} text-right tabular-nums`}>
          <button
            type="button"
            onClick={onAnalytics}
            className={`${readClass} text-right ${item.usage_per_day == null ? 'text-white/20' : 'text-white/70'}`}
            title="Analytics"
            aria-label={`Analytics for ${item.name}`}
          >
            {item.usage_per_day == null ? '—' : formatPerWeek(item.usage_per_day)}
          </button>
        </td>
      )}
      {shown.has('days_left') && (
        <td
          className={`${cellClass} truncate whitespace-nowrap px-3.5 ${
            left != null && item.count_every_days != null && left <= item.count_every_days
              ? 'text-[var(--pyre-red)]'
              : 'text-white/70'
          }`}
          title={
            left != null && item.count_every_days != null && left <= item.count_every_days
              ? 'Likely to run out before its next count'
              : undefined
          }
        >
          {left == null ? <span className="text-white/20">—</span> : `~${formatDaysLeft(left)}`}
        </td>
      )}
      {shown.has('count_every_days') && (
        <td className={cellClass}>
          <ScheduleCell
            value={item.count_every_days}
            label={`Count schedule for ${item.name}`}
            editable={canManage}
            onSave={(days) => onSave({ count_every_days: days })}
          />
        </td>
      )}
      {shown.has('unit_cost_cents') && (
        <td className={`${cellClass} text-right`}>
          <TextCell
            value={formatCents(item.unit_cost_cents)}
            label={`Cost per unit for ${item.name}`}
            editable={canManage}
            numeric
            onSave={(v) => {
              if (!v) return onSave({ unit_cost_cents: null });
              const cents = parseDollars(v);
              return cents == null ? Promise.resolve(false) : onSave({ unit_cost_cents: cents });
            }}
          />
        </td>
      )}
      {shown.has('vendor') && (
        <td className={cellClass}>
          <TextCell
            value={item.vendor ?? ''}
            label={`Vendor for ${item.name}`}
            editable={canManage}
            onSave={(v) => onSave({ vendor: v || null })}
          />
        </td>
      )}
      {shown.has('how_to_order') && (
        <td className={cellClass}>
          <TextCell
            value={item.how_to_order ?? ''}
            label={`How to order ${item.name}`}
            editable={canManage}
            multiline
            display={
              link ? (
                <span className="flex items-center gap-2">
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="truncate text-[var(--pyre-gold)] underline"
                  >
                    {linkLabel(link)}
                  </a>
                  {item.how_to_order?.trim() !== link && (
                    <span className="truncate text-white/50">
                      {item.how_to_order?.trim().slice(link.length).trim()}
                    </span>
                  )}
                </span>
              ) : undefined
            }
            onSave={(v) => onSave({ how_to_order: v || null })}
          />
        </td>
      )}
      <td className={`${cellClass} text-right`}>
        <RowMenu
          itemName={item.name}
          actions={[
            { label: canManage ? 'Edit details' : 'View details', onSelect: onDetails },
            { label: 'Analytics', onSelect: onAnalytics },
            ...(canManage
              ? [
                  {
                    label: item.active ? 'Mark inactive' : 'Mark active',
                    onSelect: onToggleActive,
                  },
                  { label: 'Delete', onSelect: onDelete, danger: true },
                ]
              : []),
          ]}
        />
      </td>
    </tr>
  );
}

const reorderChipClass = `${chipClass} border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]`;

/**
 * The Re-order chip, which takes you to how to re-order: the order link in a
 * new tab, the written instructions in a dialog, or (with neither set) the
 * item's details so they can be filled in.
 */
function ReorderChip({
  link,
  hasInstructions,
  onShowOrder,
  onDetails,
}: {
  link: string | null;
  hasInstructions: boolean;
  onShowOrder: () => void;
  onDetails: () => void;
}) {
  const interactive = `${reorderChipClass} hover:border-[var(--pyre-red)] hover:bg-[var(--pyre-red)]/25`;
  if (link) {
    return (
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className={interactive}
        title="Open the order link"
      >
        Re-order ↗
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={hasInstructions ? onShowOrder : onDetails}
      className={interactive}
      title={hasInstructions ? 'How to order' : 'No ordering info yet'}
    >
      Re-order
    </button>
  );
}

/**
 * Counting one item, opened from its Due chip: its count instructions (when
 * it has any) above an In stock box. Saving — even the same number — records
 * the count.
 */
function CountDialog({
  item,
  onSave,
  onClose,
}: {
  item: InventoryRow;
  /** Resolves to an error message, or null once saved. */
  onSave: (inStock: number) => Promise<string | null>;
  onClose: () => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(formatQuantity(item.in_stock));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => inputRef.current?.select(), []);

  const submit = async () => {
    const n = parseQuantity(value);
    if (n == null) return setError('Enter how many are in stock');
    setBusy(true);
    const failure = await onSave(n);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <Modal
      labelledBy={id}
      onClose={onClose}
      initialFocus={inputRef}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-lg flex-col overflow-y-auto p-5`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="truncate text-lg font-semibold text-[var(--pyre-creme)]">
            Count {item.name}
          </h2>
          <p className="mt-1 text-xs text-white/50">
            {item.count_every_days ? countEveryLabel(item.count_every_days) : 'No schedule'}
            {item.last_counted_at
              ? ` · last counted ${etStamp(item.last_counted_at)}`
              : ' · never counted'}
          </p>
        </div>
        <button type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>
      {item.location && (
        <div className="mb-3 rounded border border-white/15 bg-white/[0.04] p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-white/50">
            Where it's kept
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--pyre-creme)]">
            {item.location}
          </p>
        </div>
      )}
      {item.count_instructions && (
        <div className="mb-4 rounded border border-[var(--pyre-gold)]/30 bg-[var(--pyre-gold)]/5 p-3">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
            How to count
          </p>
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--pyre-creme)]">
            {item.count_instructions}
          </p>
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex-1">
          <span className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-white/50">
            In stock
          </span>
          <input
            ref={inputRef}
            inputMode="decimal"
            value={value}
            disabled={busy}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            className={`${compactInputClass} w-full text-lg`}
          />
        </label>
        <button type="submit" className={goldButtonClass} disabled={busy}>
          {busy ? 'Saving…' : 'Save count'}
        </button>
      </form>
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}
    </Modal>
  );
}

/** An item's how-to-order instructions, opened from its Re-order chip. */
function OrderInstructions({
  item,
  onEdit,
  onClose,
}: {
  item: InventoryRow;
  /** Admins can jump to the details form from here. */
  onEdit?: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      labelledBy={id}
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-lg flex-col overflow-y-auto p-5`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="truncate text-lg font-semibold text-[var(--pyre-creme)]">
            How to order {item.name}
          </h2>
          <p className="mt-1 text-xs text-white/50">
            {formatQuantity(item.in_stock)} in stock
            {item.reorder_at != null && ` · re-order at ${formatQuantity(item.reorder_at)}`}
            {item.vendor && ` · ${item.vendor}`}
          </p>
        </div>
        <button ref={closeRef} type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-[var(--pyre-creme)]">
        {item.how_to_order}
      </p>
      {onEdit && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <button type="button" className={buttonClass} onClick={onEdit}>
            Edit details
          </button>
        </div>
      )}
    </Modal>
  );
}

interface MenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A row's actions menu. Positioned `fixed` from the button so the table's
 * scroll container can't clip it; closes on a pick, a click elsewhere,
 * Escape, or a scroll.
 */
function RowMenu({ itemName, actions }: { itemName: string; actions: MenuAction[] }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = () => setAt(null);
    const onPointer = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setAt(null);
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAt({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  // Arrow keys move between items, as in any menu.
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const entries = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
    entries[next]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Options for ${itemName}`}
        className="rounded px-2 py-1 text-white/40 hover:bg-white/5 hover:text-white"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="8" cy="13" r="1.5" />
        </svg>
      </button>
      {at && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          tabIndex={-1}
          onKeyDown={onMenuKey}
          style={{ top: at.top, right: at.right }}
          className="fixed z-40 min-w-[10rem] rounded border border-white/15 bg-[var(--pyre-black)] py-1 text-left shadow-xl"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null);
                a.onSelect();
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/5 focus:bg-white/5 focus:outline-none ${
                a.danger ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-creme)]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** 'uline.com' for a link — the full URL is in the tooltip. */
function linkLabel(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

/**
 * One editable cell: shows the value, turns into an input on click, saves
 * on Enter or blur, cancels on Escape. A rejected value (or a failed save)
 * keeps the input open so it can be fixed.
 */
function TextCell({
  value,
  label,
  editable,
  numeric = false,
  confirmUnchanged = false,
  multiline = false,
  tone,
  display,
  onSave,
}: {
  value: string;
  label: string;
  editable: boolean;
  numeric?: boolean;
  /** Enter on an unchanged value still saves (confirms a count). */
  confirmUnchanged?: boolean;
  multiline?: boolean;
  tone?: string;
  display?: ReactNode;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const shown = display ?? (value || <span className="text-white/20">{editable ? '—' : ''}</span>);
  const align = numeric ? 'text-right tabular-nums' : '';

  if (!editable) {
    return (
      <span
        className={`block px-1.5 py-1 ${align} ${tone ?? ''} ${multiline ? 'truncate' : ''}`}
        title={multiline ? value : undefined}
      >
        {shown}
      </span>
    );
  }
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value)}
        className={`${readClass} ${align} ${tone ?? ''} ${multiline ? 'truncate' : ''}`}
        title={multiline && value ? value : undefined}
        aria-label={`${label}: ${value || 'empty'}. Edit`}
      >
        {shown}
      </button>
    );
  }

  const commit = async (confirm = false) => {
    const next = draft.trim();
    if (next === value.trim() && !(confirm && confirmUnchanged)) {
      setDraft(null);
      return;
    }
    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) {
      setDraft(null);
      setInvalid(false);
    } else {
      setInvalid(true);
      inputRef.current?.focus();
    }
  };
  const props = {
    ref: inputRef,
    value: draft,
    disabled: busy,
    'aria-label': label,
    'aria-invalid': invalid || undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      setInvalid(false);
    },
    onBlur: () => void commit(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(null);
        setInvalid(false);
      }
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        void commit(true);
      }
    },
    className: `${editClass} ${align} ${invalid ? 'border-[var(--pyre-red)]' : ''}`,
  };
  return multiline ? (
    <textarea {...props} rows={3} placeholder="A link, or how to order it" />
  ) : (
    <input {...props} inputMode={numeric ? 'decimal' : undefined} />
  );
}

/**
 * The drag strip on a header's right edge. Dragging sets the column's width
 * (saved when the drag ends), arrow keys nudge it, double-click resets it.
 */
function ResizeHandle({
  label,
  width,
  onResize,
  onReset,
}: {
  label: string;
  width: number;
  onResize: (width: number, persist: boolean) => void;
  onReset: () => void;
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let last = startWidth;
    const move = (ev: PointerEvent) => {
      last = startWidth + ev.clientX - startX;
      onResize(last, false);
    };
    const up = () => {
      onResize(last, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no native element
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onResize(width + (e.key === 'ArrowRight' ? 16 : -16), true);
        }
      }}
      className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-px after:bg-white/15 hover:after:bg-[var(--pyre-gold)] focus:outline-none focus-visible:after:bg-[var(--pyre-gold)]"
    />
  );
}

/** How often to count: a drop-down that saves on change. */
function ScheduleCell({
  value,
  label,
  editable,
  onSave,
}: {
  value: number | null;
  label: string;
  editable: boolean;
  onSave: (days: number | null) => Promise<boolean>;
}) {
  if (!editable) {
    return (
      <span className="block px-1.5 py-1 text-white/70">{value ? countEveryLabel(value) : ''}</span>
    );
  }
  const options: number[] = [...COUNT_SCHEDULES];
  if (value && !options.includes(value)) options.push(value);
  return (
    <select
      value={value ?? ''}
      onChange={(e) => void onSave(e.target.value ? Number(e.target.value) : null)}
      aria-label={label}
      className={`${compactSelectClass} w-full border-transparent bg-transparent hover:border-white/10`}
    >
      <option value="">—</option>
      {options.map((days) => (
        <option key={days} value={days}>
          {countEveryLabel(days)}
        </option>
      ))}
    </select>
  );
}
