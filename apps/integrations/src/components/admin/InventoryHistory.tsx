// The ledger (/admin/inventory/history): every stock movement, newest first,
// filterable by item, area, type, and date, with a CSV export of the same
// filter. The ledger is append-only — a mis-entry is fixed by an admin
// logging a correction here, never by editing the original row.

import { useMemo, useRef, useState } from 'react';
import {
  buttonClass,
  compactInputClass,
  compactSelectClass,
  labelClass,
} from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStampWithYear } from '@/lib/client/format';
import { formatCents, formatUnits, parseSignedQuantity, pluralUnit } from '@/lib/inventory/rules';
import {
  type InventoryLedgerPage,
  type InventoryOverview,
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  type MovementType,
} from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { primaryButtonClass } from './incidentUi';
import {
  dialogPanelClass,
  INVENTORY_API,
  MOVEMENTS_API,
  MovementBadge,
  signed,
} from './inventoryUi';
import { Modal } from './Modal';

const PAGE_SIZE = 50;

export function InventoryHistory() {
  const overview = useCachedJson<InventoryOverview>(INVENTORY_API);
  const [itemId, setItemId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [type, setType] = useState<MovementType | ''>('');
  const [since, setSince] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [correcting, setCorrecting] = useState(false);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (itemId) params.set('itemId', itemId);
    if (areaId) params.set('areaId', areaId);
    if (type) params.set('type', type);
    if (since) params.set('since', since);
    return params;
  }, [itemId, areaId, type, since]);

  const pageUrl = `${MOVEMENTS_API}?${new URLSearchParams([...filterParams, ['limit', String(limit)]])}`;
  const csvUrl = `${MOVEMENTS_API}?${new URLSearchParams([...filterParams, ['format', 'csv']])}`;
  const ledger = useCachedJson<InventoryLedgerPage>(pageUrl);

  const items = overview.data?.items ?? [];
  const areas = overview.data?.areas ?? [];
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const resetPaging = () => setLimit(PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="min-w-0">
          <span className={labelClass}>Item</span>
          <select
            value={itemId}
            onChange={(e) => {
              setItemId(e.target.value);
              resetPaging();
            }}
            className={`${compactSelectClass} w-full`}
          >
            <option value="">All items</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.active ? '' : ' (retired)'}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Area</span>
          <select
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              resetPaging();
            }}
            className={`${compactSelectClass} w-full`}
          >
            <option value="">All areas</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? '' : ' (retired)'}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Type</span>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as MovementType | '');
              resetPaging();
            }}
            className={`${compactSelectClass} w-full`}
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MOVEMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Since</span>
          <input
            type="date"
            value={since}
            onChange={(e) => {
              setSince(e.target.value);
              resetPaging();
            }}
            className={`${compactInputClass} w-full`}
          />
        </label>
        <div className="col-span-2 flex gap-2 sm:ml-auto">
          <a href={csvUrl} className={buttonClass} download>
            Export CSV
          </a>
          {overview.data?.isAdmin && (
            <button type="button" className={buttonClass} onClick={() => setCorrecting(true)}>
              Log correction
            </button>
          )}
        </div>
      </div>

      {ledger.error && !ledger.data && (
        <ErrorBanner>Couldn't load history: {ledger.error}</ErrorBanner>
      )}
      {ledger.loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {ledger.data && ledger.data.movements.length === 0 && (
        <p className="text-sm text-white/50">
          Nothing logged yet{filterParams.size ? ' for this filter' : ''}.
        </p>
      )}

      {ledger.data && ledger.data.movements.length > 0 && (
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {ledger.data.movements.map((m) => {
            const item = itemById.get(m.item_id);
            const value =
              m.unit_cost_cents == null
                ? ''
                : formatCents(Math.round(m.quantity * m.unit_cost_cents));
            return (
              <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--pyre-creme)]">
                      {item?.name ?? 'Unknown item'}
                    </span>
                    <MovementBadge type={m.movement_type} />
                  </div>
                  <p className="text-xs text-white/45">
                    {areaById.get(m.area_id)?.name ?? 'Unknown area'} ·{' '}
                    {etStampWithYear(m.occurred_at)} ·{' '}
                    {personName(m.recorded_by, ledger.data?.people)}
                  </p>
                  {(m.reason || m.note) && (
                    <p className="mt-0.5 text-xs text-white/60">
                      {[m.reason, m.note].filter(Boolean).join(' — ')}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`block text-sm ${m.quantity < 0 ? 'text-white/80' : 'text-[var(--pyre-sage)]'}`}
                  >
                    {signed(m.quantity)} {item ? pluralUnit(m.quantity, item.unit) : ''}
                  </span>
                  {value && <span className="block text-[10px] text-white/40">{value}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {ledger.data && ledger.data.total > ledger.data.movements.length && (
        <button
          type="button"
          className={buttonClass}
          disabled={ledger.refreshing}
          onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, 200))}
        >
          {limit >= 200 ? 'Narrow the filter to see older entries' : 'Show more'}
        </button>
      )}

      {correcting && overview.data && (
        <CorrectionDialog
          overview={overview.data}
          onClose={() => setCorrecting(false)}
          onSaved={async () => {
            setCorrecting(false);
            invalidateJson(INVENTORY_API);
            invalidateJson(MOVEMENTS_API);
            await Promise.all([ledger.reload(), overview.reload()]);
          }}
        />
      )}
    </div>
  );
}

/**
 * Admin-only: put right a mis-entry (someone logged 20 instead of 2) with a
 * signed correction. It is excluded from usage and loss, and needs a note so
 * the ledger says why.
 */
function CorrectionDialog({
  overview,
  onClose,
  onSaved,
}: {
  overview: InventoryOverview;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const items = overview.items.filter((i) => i.active);
  const areas = overview.areas.filter((a) => a.active);
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const amount = parseSignedQuantity(quantity);
  const item = items.find((i) => i.id === itemId);
  const onHand =
    overview.stock.find((s) => s.item_id === itemId && s.area_id === areaId)?.quantity ?? 0;

  const submit = async () => {
    if (amount == null || !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(MOVEMENTS_API, 'POST', {
        type: 'correction',
        itemId,
        areaId,
        quantity: amount,
        note,
      });
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      labelledBy="inventory-correction"
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={dialogPanelClass}
    >
      <div className="mb-4 flex items-start gap-3">
        <h2 id="inventory-correction" className="flex-1 text-lg text-[var(--pyre-creme)]">
          Log a correction
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
      <p className="mb-4 text-xs text-white/50">
        For fixing a mis-entry. Corrections are not counted as usage or loss. To record a shortfall
        found on the shelf, use a count instead.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className={labelClass}>Item</span>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={`${compactSelectClass} w-full`}
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Area</span>
          <select
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
            className={`${compactSelectClass} w-full`}
          >
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mb-3 block">
        <span className={labelClass}>Change (+ adds, − removes)</span>
        <input
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.-]/g, ''))}
          placeholder="-18"
          className={`${compactInputClass} w-full`}
        />
        <span className="mt-1 block text-xs text-white/40">
          {item ? `${formatUnits(onHand, item.unit)} here now` : ''}
          {item && amount != null ? ` → ${formatUnits(onHand + amount, item.unit)}` : ''}
        </span>
      </label>
      <label className="mb-4 block">
        <span className={labelClass}>Why</span>
        <input
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Logged 20 instead of 2 on Tuesday"
          className={`${compactInputClass} w-full`}
        />
      </label>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || amount == null || !note.trim() || !itemId || !areaId}
        className={`${primaryButtonClass} w-full`}
      >
        {busy ? 'Saving…' : 'Save correction'}
      </button>
    </Modal>
  );
}
