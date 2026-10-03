// The Rejects tab (/admin/inventory/rejects): deliveries we turned away.
//
//   Tiles          — waiting for pickup, credit owed, credited (90 days)
//   Over time      — one item's rejected units per week, with the reject rate
//                    (rejected ÷ delivered) in the readout and the table
//   Waiting for pickup — rejects held on site; whoever sees the driver take
//                    them taps Picked up (the receive form also asks)
//   Awaiting credit — admins mark each credited (amount prefilled from the
//                    unit cost) or denied
//   Decided        — the last 90 days of credit decisions; admins can undo
//
// /api/admin/inventory-rejects is the security boundary; credit decisions
// are admin-only there and only offered to admins here.

import { useEffect, useState } from 'react';
import { buttonClass, compactInputClass, goldButtonClass, labelClass } from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp, fmtShortDate } from '@/lib/client/format';
import { rejectRate, rejectValueCents } from '@/lib/inventory/rejects';
import { formatCents, formatQuantity, formatUnits, pluralUnit } from '@/lib/inventory/rules';
import type { RejectSeries, RejectsOverview, RejectView } from '@/lib/inventory/types';
import { dollarsToCents } from '@/lib/inventory/validate';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { REJECTS_API } from './InventoryDeliveryFields';
import { InventoryRejectChart } from './InventoryRejectChart';
import { Chip, primaryButtonClass } from './incidentUi';
import { dialogPanelClass } from './inventoryUi';
import { Modal } from './Modal';

const WEEK_OPTIONS = [12, 26, 52] as const;

const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

const sectionTitle = 'mb-2 font-mono text-xs uppercase tracking-wide text-white/50';

export function InventoryRejects() {
  const { data, error, loading, reload } = useCachedJson<RejectsOverview>(REJECTS_API);
  const [crediting, setCrediting] = useState<RejectView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await sendJson(REJECTS_API, 'PATCH', body);
      invalidateJson(REJECTS_API);
      await reload();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load rejects: {error}</ErrorBanner>;
  if (!data) return null;

  const owed = data.pendingCredit.reduce((sum, r) => sum + (rejectValueCents(r) ?? 0), 0);
  const credited = data.decided.reduce(
    (sum, r) => sum + (r.credit_status === 'credited' ? (r.credit_cents ?? 0) : 0),
    0
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile
          label="Waiting for pickup"
          value={String(data.held.length)}
          note={
            data.held.length === 1 ? 'delivery’s rejects on site' : 'deliveries’ rejects on site'
          }
        />
        <Tile
          label="Credit owed"
          value={formatCents(owed) || '$0.00'}
          note={`${data.pendingCredit.length} awaiting a credit`}
          tone="text-[var(--pyre-gold)]"
        />
        <Tile
          label="Credited, last 90 days"
          value={formatCents(credited) || '$0.00'}
          tone="text-[var(--pyre-sage)]"
        />
      </div>

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}

      {data.items.length > 0 ? (
        <OverTime items={data.items} />
      ) : (
        <p className="text-sm text-white/50">
          No rejects yet. They're recorded when receiving a delivery: enter how many were turned
          away and why.
        </p>
      )}

      <section aria-labelledby="held-heading">
        <h2 id="held-heading" className={sectionTitle}>
          Waiting for pickup ({data.held.length})
        </h2>
        {data.held.length === 0 ? (
          <p className="text-sm text-white/50">Nothing is waiting for the driver.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {data.held.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <RejectSummary reject={r} people={data.people} />
                <button
                  type="button"
                  className={goldButtonClass}
                  disabled={busyId === r.id}
                  onClick={() => act(r.id, { action: 'pickup', ids: [r.id] })}
                >
                  Picked up
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="credit-heading">
        <h2 id="credit-heading" className={sectionTitle}>
          Awaiting credit ({data.pendingCredit.length})
        </h2>
        {data.pendingCredit.length === 0 ? (
          <p className="text-sm text-white/50">No credits outstanding.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {data.pendingCredit.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <RejectSummary reject={r} people={data.people} showValue />
                {data.isAdmin && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={goldButtonClass}
                      onClick={() => setCrediting(r)}
                    >
                      Credited
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, { action: 'deny', id: r.id })}
                    >
                      Denied
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!data.isAdmin && data.pendingCredit.length > 0 && (
          <p className="mt-2 text-xs text-white/40">An admin records credits from the vendor.</p>
        )}
      </section>

      {data.decided.length > 0 && (
        <section aria-labelledby="decided-heading">
          <h2 id="decided-heading" className={sectionTitle}>
            Decided, last 90 days
          </h2>
          <ul className="space-y-1.5 text-sm">
            {data.decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-white/60">
                <span className="text-[var(--pyre-creme)]">{r.itemName}</span>
                <span>
                  {formatUnits(r.rejected_qty, r.unit)} ({r.reasons.join(', ')}){' '}
                  {fmtShortDate(r.received_at)}
                </span>
                <span
                  className={
                    r.credit_status === 'credited'
                      ? 'text-[var(--pyre-sage)]'
                      : 'text-[var(--pyre-red)]'
                  }
                >
                  {r.credit_status === 'credited'
                    ? `credited ${formatCents(r.credit_cents)}`
                    : 'denied'}
                </span>
                <span className="text-xs text-white/40">
                  {r.credited_at && etStamp(r.credited_at)} ·{' '}
                  {personName(r.credited_by ?? '', data.people)}
                  {r.credit_note && ` · ${r.credit_note}`}
                </span>
                {data.isAdmin && (
                  <button
                    type="button"
                    className="text-xs text-white/40 underline"
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, { action: 'reopen', id: r.id })}
                  >
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {crediting && (
        <CreditDialog
          reject={crediting}
          onClose={() => setCrediting(null)}
          onSaved={async () => {
            setCrediting(null);
            invalidateJson(REJECTS_API);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  tone = 'text-[var(--pyre-creme)]',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
      <p className={`text-xl ${tone}`}>{value}</p>
      {note && <p className="text-[11px] text-white/40">{note}</p>}
    </div>
  );
}

function RejectSummary({
  reject: r,
  people,
  showValue = false,
}: {
  reject: RejectView;
  people: Record<string, string>;
  showValue?: boolean;
}) {
  const value = rejectValueCents(r);
  return (
    <div className="min-w-0 flex-1">
      <a
        href={`/admin/inventory/items/${r.item_id}`}
        className="text-sm text-[var(--pyre-creme)] hover:underline"
      >
        {r.itemName}
      </a>
      <p className="text-xs text-white/60">
        {formatUnits(r.rejected_qty, r.unit)} rejected of {formatQuantity(r.delivered_qty)} ·{' '}
        {r.reasons.join(', ')}
        {showValue && value != null && ` · ${formatCents(value)}`}
      </p>
      <p className="text-xs text-white/40">
        {etStamp(r.received_at)} · {personName(r.received_by, people)}
        {r.vendor && ` · ${r.vendor}`}
        {r.note && ` · ${r.note}`}
        {showValue && (r.picked_up_at ? ' · picked up' : ' · still on site')}
      </p>
    </div>
  );
}

function OverTime({ items }: { items: RejectsOverview['items'] }) {
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [weeks, setWeeks] = useState<(typeof WEEK_OPTIONS)[number]>(12);
  useEffect(() => {
    if (!items.some((i) => i.id === itemId) && items[0]) setItemId(items[0].id);
  }, [items, itemId]);
  const series = useCachedJson<RejectSeries>(
    itemId ? `${REJECTS_API}?itemId=${itemId}&weeks=${weeks}` : null
  );
  const unit = series.data?.unit ?? items.find((i) => i.id === itemId)?.unit ?? '';

  const totals = (series.data?.weeks ?? []).reduce(
    (acc, w) => ({
      delivered: acc.delivered + w.delivered,
      rejected: acc.rejected + w.rejected,
      cents: acc.cents + w.rejectedCents,
    }),
    { delivered: 0, rejected: 0, cents: 0 }
  );
  const rate = rejectRate(totals.rejected, totals.delivered);

  return (
    <section aria-labelledby="over-time-heading" className="space-y-3">
      <h2 id="over-time-heading" className={sectionTitle}>
        Rejected per week
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Item</legend>
          {items.map((i) => (
            <Chip
              key={i.id}
              selected={itemId === i.id}
              label={i.name}
              onClick={() => setItemId(i.id)}
            />
          ))}
        </fieldset>
        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true" />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Period</legend>
          {WEEK_OPTIONS.map((w) => (
            <Chip key={w} selected={weeks === w} label={`${w} weeks`} onClick={() => setWeeks(w)} />
          ))}
        </fieldset>
      </div>

      {series.error && !series.data && (
        <ErrorBanner>Couldn't load the weeks: {series.error}</ErrorBanner>
      )}
      {series.data && (
        <div className={`space-y-3 transition-opacity ${series.refreshing ? 'opacity-70' : ''}`}>
          <p className="text-sm text-white/70">
            {formatUnits(totals.rejected, unit)} rejected of {formatQuantity(totals.delivered)}{' '}
            delivered
            {rate != null && (
              <span className="text-[var(--pyre-creme)]"> · {rate}% reject rate</span>
            )}
            {totals.cents > 0 && ` · ${formatCents(totals.cents)}`}
          </p>
          <InventoryRejectChart weeks={series.data.weeks} unit={unit} />
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-white/50">Week by week</summary>
            <table
              className="mt-2 w-full text-right text-xs"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              <thead>
                <tr className="text-white/40">
                  <th className="py-1 text-left font-normal">Week of</th>
                  <th className="py-1 font-normal">Delivered</th>
                  <th className="py-1 font-normal">Rejected</th>
                  <th className="py-1 font-normal">Rate</th>
                  <th className="py-1 font-normal">Value</th>
                </tr>
              </thead>
              <tbody>
                {[...series.data.weeks].reverse().map((w) => (
                  <tr key={w.week} className="border-t border-white/5 text-white/70">
                    <td className="py-1 text-left">{fmtShortDate(`${w.week}T12:00:00Z`)}</td>
                    <td className="py-1">{w.delivered ? formatQuantity(w.delivered) : '—'}</td>
                    <td className="py-1">{w.rejected ? formatQuantity(w.rejected) : '—'}</td>
                    <td className="py-1">
                      {w.delivered ? `${rejectRate(w.rejected, w.delivered)}%` : '—'}
                    </td>
                    <td className="py-1">{w.rejectedCents ? formatCents(w.rejectedCents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="text-xs text-white/40">
            Delivered counts everything that arrived ({pluralUnit(2, unit)} accepted into stock plus
            those rejected), from Receive on the stock screen and the Re-order tab.
          </p>
        </div>
      )}
    </section>
  );
}

function CreditDialog({
  reject,
  onClose,
  onSaved,
}: {
  reject: RejectView;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const suggested = rejectValueCents(reject);
  const [amount, setAmount] = useState(suggested == null ? '' : (suggested / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = dollarsToCents(amount);

  const save = async () => {
    if (cents == null) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(REJECTS_API, 'PATCH', { action: 'credit', id: reject.id, cents, note });
      await onSaved();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy="credit-dialog" onClose={onClose} panelClassName={dialogPanelClass}>
      <div className="mb-4 flex items-start gap-3">
        <h2 id="credit-dialog" className="flex-1 text-lg text-[var(--pyre-creme)]">
          Credit for {reject.itemName}
        </h2>
        <button type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
      <p className="mb-4 text-sm text-white/60">
        {formatUnits(reject.rejected_qty, reject.unit)} rejected ({reject.reasons.join(', ')}) on{' '}
        {etStamp(reject.received_at)}
        {reject.vendor && ` from ${reject.vendor}`}.
      </p>
      <label className="mb-3 block">
        <span className={labelClass}>Amount credited ($)</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          className={`${compactInputClass} w-full`}
        />
        {suggested != null && (
          <span className="mt-1 block text-xs text-white/40">
            At cost: {formatCents(suggested)}
          </span>
        )}
      </label>
      <label className="mb-4 block">
        <span className={labelClass}>Note (optional)</span>
        <input
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Credit memo #, invoice…"
          className={`${compactInputClass} w-full`}
        />
      </label>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <button
        type="button"
        disabled={busy || cents == null}
        onClick={save}
        className={`${primaryButtonClass} w-full`}
      >
        {busy ? 'Saving…' : 'Save credit'}
      </button>
    </Modal>
  );
}
