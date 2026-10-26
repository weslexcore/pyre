// The inventory list (/admin/inventory): one spreadsheet-style table, a row
// per item. Click a cell to edit it; Enter or clicking away saves, Escape
// cancels. Headers sort, the toolbar searches and filters (due for a count,
// needs re-ordering, by vendor).
//
// Anyone with the page can count: set the In stock number (or press Counted
// when the shelf matches), which stamps who counted and when. Admins edit
// every other column, add items, and delete them. /api/admin/inventory is
// the security boundary; this island only offers what the viewer may do.

import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
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
import { fmtShortDate } from '@/lib/client/format';
import {
  COUNT_SCHEDULES,
  countEveryLabel,
  formatCents,
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
} from '@/lib/inventory/rules';
import { INVENTORY_API, type InventoryResponse, type InventoryRow } from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { Chip } from './incidentUi';

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
  const filter = raw === 'due' || raw === 'reorder' ? raw : null;
  const item = url.searchParams.get('item');
  if (!raw && !item) return { filter, item };
  url.searchParams.delete('filter');
  url.searchParams.delete('item');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return { filter, item };
}

type Patch = Partial<Record<keyof InventoryRow, unknown>> & { counted?: true };

interface Column {
  key: SortKey | 'how_to_order';
  label: string;
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'name', label: 'Item', className: 'min-w-[12rem]' },
  { key: 'in_stock', label: 'In stock', className: 'text-right' },
  { key: 'reorder_at', label: 'Re-order at', className: 'text-right' },
  { key: 'due', label: 'Count' },
  { key: 'last_counted_at', label: 'Last counted' },
  { key: 'count_every_days', label: 'Count every' },
  { key: 'unit_cost_cents', label: 'Cost / unit', className: 'text-right' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'how_to_order', label: 'How to order', className: 'min-w-[14rem]' },
];

const cellClass = 'border-b border-white/5 px-2 py-1 align-middle';
const readClass =
  'block w-full min-h-[2rem] rounded px-1.5 py-1 text-left hover:bg-white/5 focus:bg-white/5 focus:outline-none focus:ring-1 focus:ring-white/30';
const editClass = `${compactInputClass} w-full`;

export function InventoryList() {
  const { data, error, loading, setData } = useCachedJson<InventoryResponse>(INVENTORY_API);
  const [query, setQuery] = useState<ListQuery>({
    search: '',
    filter: 'all',
    vendor: '',
    sort: 'name',
    desc: false,
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Re-read once a minute so a daily count turns due at midnight on an open tab.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Read after mount: the island is server-rendered, where there is no URL or storage.
  useEffect(() => {
    const saved = readSortPref();
    const link = takeLinkParams();
    setQuery((q) => ({ ...q, ...saved, ...(link.filter ? { filter: link.filter } : {}) }));
    if (link.item) setHighlight(link.item);
  }, []);

  useEffect(() => {
    if (!highlight || !data) return;
    document.getElementById(`item-${highlight}`)?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setHighlight(null), 4000);
    return () => clearTimeout(timer);
  }, [highlight, data]);

  const items = data?.items ?? [];
  const rows = useMemo(() => listItems(items, query, now), [items, query, now]);
  const vendors = useMemo(
    () => [...new Set(items.map((i) => i.vendor).filter((v): v is string => !!v))].sort(),
    [items]
  );
  const dueCount = items.filter((i) => isDue(i, now)).length;
  const lowCount = items.filter(isLow).length;

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
      setHighlight(res.item.id);
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const remove = async (item: InventoryRow) => {
    if (!window.confirm(`Delete ${item.name}? This can't be undone.`)) return;
    setSaveError(null);
    try {
      await sendJson(`${INVENTORY_API}?id=${item.id}`, 'DELETE');
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
  const { isAdmin, people } = data;

  const filters: { key: InventoryFilter; label: string }[] = [
    { key: 'all', label: `All (${items.length})` },
    { key: 'due', label: `Due for a count (${dueCount})` },
    { key: 'reorder', label: `Needs re-order (${lowCount})` },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query.search}
          onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value }))}
          placeholder="Search items, vendors"
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
        {vendors.length > 0 && (
          <select
            value={query.vendor}
            onChange={(e) => setQuery((q) => ({ ...q, vendor: e.target.value }))}
            aria-label="Filter by vendor"
            className={compactSelectClass}
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        {isAdmin && (
          <button
            type="button"
            className={`${goldButtonClass} sm:ml-auto`}
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            Add item
          </button>
        )}
      </div>

      {saveError && <ErrorBanner>{saveError}</ErrorBanner>}

      <div className="overflow-x-auto rounded border border-white/10">
        <table className="w-full min-w-[64rem] border-collapse text-sm text-[var(--pyre-creme)]">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03] text-left font-mono text-[10px] uppercase tracking-wide text-white/50">
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-2 py-2 font-normal ${c.className ?? ''} ${c.key === 'name' ? 'sticky left-0 z-10 bg-[var(--pyre-black)]' : ''}`}
                  aria-sort={
                    query.sort === c.key ? (query.desc ? 'descending' : 'ascending') : undefined
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
                      {query.sort === c.key ? (query.desc ? ' ↓' : ' ↑') : ''}
                    </button>
                  )}
                </th>
              ))}
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {adding && <NewRow onAdd={add} onCancel={() => setAdding(false)} />}
            {rows.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                now={now}
                isAdmin={isAdmin}
                countedBy={item.last_counted_by ? personName(item.last_counted_by, people) : null}
                highlighted={highlight === item.id}
                onSave={(patch) => save(item.id, patch)}
                onDelete={() => remove(item)}
              />
            ))}
            {rows.length === 0 && !adding && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-white/50">
                  {items.length === 0
                    ? isAdmin
                      ? 'No items yet. Add the first one.'
                      : 'No items yet. An admin can add them.'
                    : 'Nothing matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
        Click a cell to edit. Setting In stock records a count.
        {!isAdmin && ' Only admins can change other columns.'}
      </p>
    </div>
  );
}

function NewRow({
  onAdd,
  onCancel,
}: {
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
      <td colSpan={COLUMNS.length} className={`${cellClass} text-white/50`}>
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
  isAdmin,
  countedBy,
  highlighted,
  onSave,
  onDelete,
}: {
  item: InventoryRow;
  now: Date;
  isAdmin: boolean;
  countedBy: string | null;
  highlighted: boolean;
  onSave: (patch: Patch) => Promise<boolean>;
  onDelete: () => void;
}) {
  const due = isDue(item, now);
  const low = isLow(item);
  const link = orderLink(item.how_to_order);
  const rowTone = highlighted ? 'bg-[var(--pyre-gold)]/10' : 'hover:bg-white/[0.02]';

  return (
    <tr id={`item-${item.id}`} className={`transition-colors ${rowTone}`}>
      <td className={`${cellClass} sticky left-0 z-10 bg-[var(--pyre-black)] font-medium`}>
        <TextCell
          value={item.name}
          label="Item name"
          editable={isAdmin}
          onSave={(v) => (v ? onSave({ name: v }) : Promise.resolve(false))}
        />
      </td>
      <td className={`${cellClass} text-right`}>
        <TextCell
          value={formatQuantity(item.in_stock)}
          label={`In stock for ${item.name}`}
          editable
          numeric
          tone={low ? 'text-[var(--pyre-red)]' : undefined}
          onSave={(v) => {
            const n = parseQuantity(v);
            return n == null ? Promise.resolve(false) : onSave({ in_stock: n });
          }}
        />
      </td>
      <td className={`${cellClass} text-right`}>
        <TextCell
          value={item.reorder_at == null ? '' : formatQuantity(item.reorder_at)}
          label={`Re-order level for ${item.name}`}
          editable={isAdmin}
          numeric
          onSave={(v) => {
            if (!v) return onSave({ reorder_at: null });
            const n = parseQuantity(v);
            return n == null ? Promise.resolve(false) : onSave({ reorder_at: n });
          }}
        />
      </td>
      <td className={`${cellClass} whitespace-nowrap`}>
        {due ? (
          <span className="inline-flex items-center gap-2">
            <span className="rounded border border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-gold)]">
              Due
            </span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void onSave({ counted: true })}
              title={`Confirm ${formatQuantity(item.in_stock)} on the shelf`}
            >
              Counted
            </button>
          </span>
        ) : (
          <span className="px-1.5 text-white/40">{item.count_every_days ? 'OK' : ''}</span>
        )}
        {low && (
          <span className="ml-2 rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-red)]">
            Re-order
          </span>
        )}
      </td>
      <td className={`${cellClass} whitespace-nowrap px-3.5 text-white/70`}>
        {item.last_counted_at ? (
          <>
            {fmtShortDate(item.last_counted_at)}
            {countedBy && <span className="text-white/40"> · {countedBy}</span>}
          </>
        ) : (
          <span className="text-white/30">Never</span>
        )}
      </td>
      <td className={cellClass}>
        <ScheduleCell
          value={item.count_every_days}
          label={`Count schedule for ${item.name}`}
          editable={isAdmin}
          onSave={(days) => onSave({ count_every_days: days })}
        />
      </td>
      <td className={`${cellClass} text-right`}>
        <TextCell
          value={formatCents(item.unit_cost_cents)}
          label={`Cost per unit for ${item.name}`}
          editable={isAdmin}
          numeric
          onSave={(v) => {
            if (!v) return onSave({ unit_cost_cents: null });
            const cents = parseDollars(v);
            return cents == null ? Promise.resolve(false) : onSave({ unit_cost_cents: cents });
          }}
        />
      </td>
      <td className={cellClass}>
        <TextCell
          value={item.vendor ?? ''}
          label={`Vendor for ${item.name}`}
          editable={isAdmin}
          onSave={(v) => onSave({ vendor: v || null })}
        />
      </td>
      <td className={`${cellClass} max-w-[20rem]`}>
        <TextCell
          value={item.how_to_order ?? ''}
          label={`How to order ${item.name}`}
          editable={isAdmin}
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
      <td className={`${cellClass} text-right`}>
        {isAdmin && (
          <button
            type="button"
            onClick={onDelete}
            className="px-2 font-mono text-[10px] uppercase tracking-wide text-white/30 hover:text-[var(--pyre-red)]"
            aria-label={`Delete ${item.name}`}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
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
  multiline = false,
  tone,
  display,
  onSave,
}: {
  value: string;
  label: string;
  editable: boolean;
  numeric?: boolean;
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

  const commit = async () => {
    const next = draft.trim();
    if (next === value.trim()) {
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
        void commit();
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
