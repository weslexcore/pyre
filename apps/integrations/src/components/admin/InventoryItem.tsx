// One inventory item (/admin/inventory/items/<id>): where it is, how much is
// left, its stock over time, and what happened to it — usage kept apart from
// loss (waste and count shortfalls) — for the last 30 / 90 / 365 days.
//
// Linked from the stock sheet, the setup list, the re-order list, and the
// reports. Reads /api/admin/inventory-reports?itemId= (and the ledger for the
// change list); both re-check the /admin/inventory grant.

import { useState } from 'react';
import { buttonClass } from '@/components/admin/ui';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etStampWithYear } from '@/lib/client/format';
import {
  formatCents,
  formatQuantity,
  formatUnits,
  lotDescription,
  lotUnit,
  pluralUnit,
  type UnitNames,
} from '@/lib/inventory/rules';
import type { InventoryLedgerPage, ItemHistory } from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { InventoryStockChart } from './InventoryStockChart';
import { Chip } from './incidentUi';
import { LowBadge, MOVEMENTS_API, MovementBadge, signed } from './inventoryUi';

const WINDOWS = [30, 90, 365] as const;

export function InventoryItem({ itemId }: { itemId: string }) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90);
  const history = useCachedJson<ItemHistory>(
    `/api/admin/inventory-reports?itemId=${itemId}&days=${days}`
  );
  const ledger = useCachedJson<InventoryLedgerPage>(`${MOVEMENTS_API}?itemId=${itemId}&limit=20`);

  if (history.loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (history.error && !history.data) {
    return <ErrorBanner>Couldn't load this item: {history.error}</ErrorBanner>;
  }
  const data = history.data;
  if (!data) return null;
  const { item, summary } = data;
  const low = item.reorder_level != null && data.total <= item.reorder_level;
  const unit: UnitNames = item;

  const tiles: { label: string; units: number; cents: number; tone: string }[] = [
    {
      label: 'Used',
      units: summary.used,
      cents: summary.usedCents,
      tone: 'text-[var(--pyre-creme)]',
    },
    {
      label: 'Wasted',
      units: summary.wasted,
      cents: summary.wastedCents,
      tone: 'text-[var(--pyre-red)]',
    },
    {
      label: 'Short on count',
      units: summary.short,
      cents: summary.shortCents,
      tone: 'text-[var(--pyre-red)]',
    },
    {
      label: 'Found on count',
      units: summary.found,
      cents: summary.foundCents,
      tone: 'text-[var(--pyre-gold)]',
    },
    {
      label: 'Received',
      units: summary.received,
      cents: summary.receivedCents,
      tone: 'text-[var(--pyre-sage)]',
    },
  ];

  return (
    <div className={`space-y-6 transition-opacity ${history.refreshing ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl text-[var(--pyre-creme)]">{item.name}</h2>
            {!item.active && <span className="text-xs text-white/40">(retired)</span>}
            {low && <LowBadge />}
            {data.openOrder && (
              <span className="rounded border border-[var(--pyre-sage)]/50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--pyre-sage)]">
                On order: {formatUnits(data.openOrder.lots, lotUnit(item))}
              </span>
            )}
          </div>
          <p className="text-xs text-white/45">
            {[
              data.category,
              lotDescription(item),
              item.unit_cost_cents != null && `${formatCents(item.unit_cost_cents)}/${item.unit}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/admin/inventory?item=${item.id}`} className={buttonClass}>
            Log a change
          </a>
          {data.isAdmin && (
            <a href={`/admin/inventory/setup?item=${item.id}`} className={buttonClass}>
              Edit
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p>
          <span className="text-4xl text-[var(--pyre-creme)]">{formatQuantity(data.total)}</span>{' '}
          <span className="text-sm text-white/50">{pluralUnit(data.total, unit)} on hand</span>
        </p>
        {item.reorder_level != null && (
          <p className="text-xs text-white/45">
            Re-order at {formatQuantity(item.reorder_level)}
            {item.reorder_target != null && `, fill to ${formatQuantity(item.reorder_target)}`}
          </p>
        )}
      </div>

      {data.spots.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs">
          {data.spots.map((s) => (
            <li
              key={s.areaId}
              className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
            >
              <span className="text-white/50">{s.areaName}</span>{' '}
              <span className="text-[var(--pyre-creme)]">{formatQuantity(s.quantity)}</span>
            </li>
          ))}
        </ul>
      )}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Time window</legend>
        {WINDOWS.map((w) => (
          <Chip key={w} selected={days === w} label={`Last ${w} days`} onClick={() => setDays(w)} />
        ))}
      </fieldset>

      <section aria-labelledby="item-chart-heading">
        <h3
          id="item-chart-heading"
          className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Stock on hand, all spots
        </h3>
        <InventoryStockChart
          points={data.points}
          unit={unit}
          reorderLevel={item.reorder_level}
          now={new Date().toISOString()}
        />
      </section>

      <section aria-labelledby="item-summary-heading">
        <h3
          id="item-summary-heading"
          className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Last {days} days
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded border border-white/10 bg-white/[0.03] p-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                {tile.label}
              </p>
              <p className={`text-lg ${tile.tone}`}>{formatQuantity(tile.units)}</p>
              <p className="text-xs text-white/40">
                {item.unit_cost_cents == null && tile.cents === 0 ? '—' : formatCents(tile.cents)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/40">
          Loss is waste plus count shortfalls:{' '}
          <span className="text-white/70">
            {formatUnits(summary.wasted + summary.short, unit)}
            {summary.wastedCents + summary.shortCents > 0 &&
              ` (${formatCents(summary.wastedCents + summary.shortCents)})`}
          </span>
          .
        </p>
      </section>

      <section aria-labelledby="item-changes-heading">
        <div className="mb-2 flex items-center gap-3">
          <h3
            id="item-changes-heading"
            className="flex-1 font-mono text-xs uppercase tracking-wide text-white/50"
          >
            Recent changes
          </h3>
          <a
            href={`/admin/inventory/history?itemId=${item.id}`}
            className="text-xs text-white/50 underline"
          >
            Full history
          </a>
        </div>
        {ledger.data && ledger.data.movements.length === 0 && (
          <p className="text-sm text-white/50">Nothing logged yet.</p>
        )}
        {ledger.data && ledger.data.movements.length > 0 && (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {ledger.data.movements.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <MovementBadge type={m.movement_type} />
                  <p className="text-xs text-white/45">
                    {etStampWithYear(m.occurred_at)} ·{' '}
                    {personName(m.recorded_by, ledger.data?.people)}
                    {(m.reason || m.note) && ` · ${[m.reason, m.note].filter(Boolean).join(' — ')}`}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm ${m.quantity < 0 ? 'text-white/80' : 'text-[var(--pyre-sage)]'}`}
                >
                  {signed(m.quantity)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
