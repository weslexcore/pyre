// The Re-order tab (/admin/inventory/reorder).
//
//   Needs ordering — items at or below their re-order level with nothing on
//     order, emptiest first, each with a suggested number of whole lots (to
//     get back to its fill-to level), the estimated cost, and its re-order
//     link. Admins mark one ordered.
//   On order — what's on its way. Whoever unpacks the delivery marks it
//     received and says where it went (and how many actually came), which
//     adds it to stock. Admins can cancel an order that isn't coming.
//   Recent — received and cancelled in the last 30 days.
//
// /api/admin/inventory-orders is the security boundary; this island only
// offers what the viewer may do.

import { useRef, useState } from 'react';
import {
  buttonClass,
  compactInputClass,
  compactSelectClass,
  goldButtonClass,
  labelClass,
} from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp, timeAgo } from '@/lib/client/format';
import {
  formatCents,
  formatQuantity,
  formatUnits,
  lotDescription,
  lotsToUnits,
  parseQuantity,
  pluralUnit,
} from '@/lib/inventory/rules';
import type { InventoryItemRow, ReorderLine, ReorderOverview } from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import {
  DeliveryFields,
  type DeliveryState,
  deliveryBody,
  deliveryReady,
  deliveryReasons,
  EMPTY_DELIVERY,
  rejectedUnits,
} from './InventoryDeliveryFields';
import { primaryButtonClass } from './incidentUi';
import {
  dialogPanelClass,
  INVENTORY_API,
  LowBadge,
  MOVEMENTS_API,
  QuantityStepper,
} from './inventoryUi';
import { Modal } from './Modal';

const ORDERS_API = '/api/admin/inventory-orders';

const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

const lotName = (item: Pick<InventoryItemRow, 'lot_label'>, n: number) =>
  pluralUnit(n, item.lot_label?.trim() || 'lot');

const itemHref = (id: string) => `/admin/inventory/items/${id}`;

function refreshAll() {
  invalidateJson(ORDERS_API);
  invalidateJson(INVENTORY_API);
  invalidateJson(MOVEMENTS_API);
  invalidateJson('/api/admin/inventory-reports');
}

type Dialog =
  | { kind: 'order'; line: ReorderLine }
  | { kind: 'receive'; order: ReorderOverview['open'][number] }
  | { kind: 'cancel'; order: ReorderOverview['open'][number] };

export function InventoryReorder() {
  const { data, error, loading, reload } = useCachedJson<ReorderOverview>(ORDERS_API);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load re-orders: {error}</ErrorBanner>;
  if (!data) return null;

  const done = async (text: string) => {
    setDialog(null);
    setFlash(text);
    refreshAll();
    await reload();
  };

  const neededCost = data.needed.reduce((sum, l) => sum + (l.estimateCents ?? 0), 0);

  return (
    <div className="space-y-8">
      {flash && (
        <p
          role="status"
          className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]"
        >
          {flash}
        </p>
      )}

      <section aria-labelledby="needed-heading">
        <h2
          id="needed-heading"
          className="mb-1 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Needs ordering ({data.needed.length})
        </h2>
        <p className="mb-3 text-xs text-white/40">
          At or below the re-order level, with nothing on order. Suggestions round up to whole lots
          to reach each item's fill-to level.
          {neededCost > 0 && ` Estimated total: ${formatCents(neededCost)}.`}
        </p>
        {data.needed.length === 0 ? (
          <p className="text-sm text-white/50">Nothing needs ordering right now.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {data.needed.map((line) => (
              <li key={line.item.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={itemHref(line.item.id)}
                      className="text-sm text-[var(--pyre-creme)] hover:underline"
                    >
                      {line.item.name}
                    </a>
                    <LowBadge>{formatQuantity(line.total)} left</LowBadge>
                  </div>
                  <p className="text-xs text-white/50">
                    Order {formatQuantity(line.suggestedLots)}{' '}
                    {lotName(line.item, line.suggestedLots)}
                    {lotDescription(line.item) &&
                      ` (${formatUnits(line.suggestedUnits, line.item.unit)})`}
                    {line.estimateCents != null && ` · ~${formatCents(line.estimateCents)}`}
                  </p>
                  <p className="text-xs text-white/35">
                    {[
                      line.category,
                      `re-order at ${formatQuantity(line.item.reorder_level ?? 0)}`,
                      line.item.vendor,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {line.item.vendor_url && (
                      <>
                        {' · '}
                        <a
                          href={line.item.vendor_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--pyre-gold)] underline"
                        >
                          re-order link
                        </a>
                      </>
                    )}
                  </p>
                </div>
                {data.isAdmin && (
                  <button
                    type="button"
                    className={goldButtonClass}
                    onClick={() => setDialog({ kind: 'order', line })}
                  >
                    Mark ordered
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!data.isAdmin && data.needed.length > 0 && (
          <p className="mt-2 text-xs text-white/40">
            An admin places orders; they've been notified.
          </p>
        )}
      </section>

      <section aria-labelledby="open-heading">
        <h2
          id="open-heading"
          className="mb-3 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          On order ({data.open.length})
        </h2>
        {data.open.length === 0 ? (
          <p className="text-sm text-white/50">Nothing is on order.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {data.open.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={itemHref(order.item.id)}
                    className="text-sm text-[var(--pyre-creme)] hover:underline"
                  >
                    {order.item.name}
                  </a>
                  <p className="text-xs text-white/50">
                    {formatQuantity(order.lots)} {lotName(order.item, order.lots)} ·{' '}
                    {formatUnits(order.units, order.item.unit)}
                    {order.unit_cost_cents != null &&
                      ` · ~${formatCents(Math.round(order.units * order.unit_cost_cents))}`}
                  </p>
                  <p className="text-xs text-white/35">
                    Ordered {timeAgo(order.ordered_at)} by{' '}
                    {personName(order.ordered_by, data.people)} ·{' '}
                    {formatUnits(order.total, order.item.unit)} on hand now
                    {order.note && ` · ${order.note}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={goldButtonClass}
                    disabled={data.areas.length === 0}
                    onClick={() => setDialog({ kind: 'receive', order })}
                  >
                    Received
                  </button>
                  {data.isAdmin && (
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => setDialog({ kind: 'cancel', order })}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2
            id="recent-heading"
            className="mb-3 font-mono text-xs uppercase tracking-wide text-white/50"
          >
            Last 30 days
          </h2>
          <ul className="space-y-1 text-sm">
            {data.recent.map((order) => (
              <li key={order.id} className="text-white/60">
                <a
                  href={itemHref(order.item_id)}
                  className="text-[var(--pyre-creme)] hover:underline"
                >
                  {order.itemName}
                </a>{' '}
                {order.status === 'received' && order.received_at ? (
                  <>
                    — received {formatUnits(order.received_units ?? order.units, order.unit)}
                    {order.areaName && ` into ${order.areaName}`} · {etStamp(order.received_at)} by{' '}
                    {personName(order.received_by ?? '', data.people)}
                  </>
                ) : (
                  <>
                    — cancelled {order.cancelled_at ? etStamp(order.cancelled_at) : ''} by{' '}
                    {personName(order.cancelled_by ?? '', data.people)}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog?.kind === 'order' && (
        <OrderDialog line={dialog.line} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === 'receive' && (
        <ReceiveDialog
          order={dialog.order}
          areas={data.areas}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === 'cancel' && (
        <CancelDialog order={dialog.order} onClose={() => setDialog(null)} onDone={done} />
      )}
    </div>
  );
}

function DialogHeader({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <h2 id={id} className="flex-1 text-lg text-[var(--pyre-creme)]">
        {title}
      </h2>
      <button type="button" onClick={onClose} className={buttonClass}>
        Close
      </button>
    </div>
  );
}

function OrderDialog({
  line,
  onClose,
  onDone,
}: {
  line: ReorderLine;
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const { item } = line;
  const [lots, setLots] = useState(formatQuantity(line.suggestedLots));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseQuantity(lots);
  const units = parsed == null ? null : lotsToUnits(parsed, item.lot_size);

  const save = async () => {
    if (parsed == null) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(ORDERS_API, 'POST', { itemId: item.id, lots: parsed, note });
      await onDone(
        `${item.name}: ${formatQuantity(parsed)} ${lotName(item, parsed)} marked ordered.`
      );
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="order-dialog" onClose={onClose} panelClassName={dialogPanelClass}>
      <DialogHeader id="order-dialog" title={`Order ${item.name}`} onClose={onClose} />
      <label htmlFor="order-lots" className={labelClass}>
        How many {pluralUnit(2, item.lot_label?.trim() || 'lot')}
      </label>
      <QuantityStepper id="order-lots" value={lots} onChange={setLots} label="lots" />
      {units != null && lotDescription(item) && (
        <p className="mt-1 text-xs text-white/50">= {formatUnits(units, item.unit)}</p>
      )}
      <label className="mt-4 block">
        <span className={labelClass}>Note (optional)</span>
        <input
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Order #, expected date…"
          className={`${compactInputClass} w-full`}
        />
      </label>
      {item.vendor_url && (
        <p className="mt-3 text-xs">
          <a
            href={item.vendor_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--pyre-gold)] underline"
          >
            Open the re-order link{item.vendor ? ` (${item.vendor})` : ''}
          </a>
        </p>
      )}
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}
      <button
        type="button"
        disabled={busy || parsed == null}
        onClick={save}
        className={`${primaryButtonClass} mt-4 w-full`}
      >
        {busy ? 'Saving…' : 'Mark ordered'}
      </button>
    </Modal>
  );
}

function ReceiveDialog({
  order,
  areas,
  onClose,
  onDone,
}: {
  order: ReorderOverview['open'][number];
  areas: ReorderOverview['areas'];
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const { item } = order;
  const [units, setUnits] = useState(formatQuantity(order.units));
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [delivery, setDelivery] = useState<DeliveryState>(EMPTY_DELIVERY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A delivery can be all rejects, so 0 accepted is allowed.
  const parsed = units.trim() !== '' && Number(units) === 0 ? 0 : parseQuantity(units);
  const rejected = rejectedUnits(delivery) ?? 0;
  const ready = parsed != null && !!areaId && deliveryReady(delivery) && parsed + rejected > 0;
  const areaRef = useRef<HTMLSelectElement>(null);

  const save = async () => {
    if (!ready || parsed == null) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(ORDERS_API, 'PATCH', {
        action: 'receive',
        id: order.id,
        areaId,
        units: parsed,
        ...deliveryBody(delivery),
      });
      const area = areas.find((a) => a.id === areaId)?.name ?? '';
      await onDone(
        `Received ${formatUnits(parsed, item.unit)} of ${item.name} into ${area}.${
          rejected
            ? ` ${formatUnits(rejected, item.unit)} rejected (${deliveryReasons(delivery).join(', ')}).`
            : ''
        }`
      );
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      labelledBy="receive-dialog"
      onClose={onClose}
      initialFocus={areaRef}
      panelClassName={dialogPanelClass}
    >
      <DialogHeader id="receive-dialog" title={`Receive ${item.name}`} onClose={onClose} />
      <label className="mb-4 block">
        <span className={labelClass}>Put away in</span>
        <select
          ref={areaRef}
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
      <label htmlFor="receive-units" className={labelClass}>
        Accepted — {pluralUnit(2, item.unit)} into stock
      </label>
      <QuantityStepper id="receive-units" value={units} onChange={setUnits} label="units" min={0} />
      <p className="mt-1 text-xs text-white/50">
        Ordered: {formatQuantity(order.lots)} {lotName(item, order.lots)} (
        {formatUnits(order.units, item.unit)}). Change it if the delivery was short or some were
        rejected.
      </p>
      <div className="mt-4">
        <DeliveryFields
          idPrefix="receive"
          itemId={item.id}
          unit={item.unit}
          value={delivery}
          onChange={setDelivery}
        />
      </div>
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}
      <button
        type="button"
        disabled={busy || !ready}
        onClick={save}
        className={`${primaryButtonClass} mt-4 w-full`}
      >
        {busy
          ? 'Saving…'
          : parsed == null
            ? 'Enter a quantity'
            : rejected
              ? `Receive ${formatUnits(parsed, item.unit)} · reject ${formatQuantity(rejected)}`
              : `Receive ${formatUnits(parsed, item.unit)}`}
      </button>
    </Modal>
  );
}

function CancelDialog({
  order,
  onClose,
  onDone,
}: {
  order: ReorderOverview['open'][number];
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendJson(ORDERS_API, 'PATCH', { action: 'cancel', id: order.id });
      await onDone(`Order for ${order.item.name} cancelled.`);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <Modal labelledBy="cancel-dialog" onClose={onClose} panelClassName={dialogPanelClass}>
      <DialogHeader id="cancel-dialog" title="Cancel this order?" onClose={onClose} />
      <p className="mb-4 text-sm text-white/60">
        {order.item.name} goes back on the "needs ordering" list if it's still low. Nothing is added
        to or taken from stock.
      </p>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <button
        type="button"
        disabled={busy}
        onClick={cancel}
        className={`${primaryButtonClass} w-full`}
      >
        {busy ? 'Saving…' : 'Cancel order'}
      </button>
    </Modal>
  );
}
