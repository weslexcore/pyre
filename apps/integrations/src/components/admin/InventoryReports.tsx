// The Reports tab (/admin/inventory/reports): usage vs loss over a period,
// by item, category, or storage area, in units and dollars.
//
//   Used      — taken out to be used (everyday consumption)
//   Wasted    — known loss: broken, expired (logged with a reason)
//   Short     — unexplained loss: a count found fewer than expected
//   Found     — a count found more than expected
//   Received  — deliveries
//
// Filters sit in one row above everything they scope; the tiles and the table
// always agree. Rows lead with the biggest loss in dollars. Item rows link to
// the item page (its stock-over-time chart and history).

import { useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { formatCents, formatQuantity } from '@/lib/inventory/rules';
import type { InventoryReport, ReportGroup, ReportRow } from '@/lib/inventory/types';
import { ErrorBanner } from './ErrorBanner';
import { Chip } from './incidentUi';

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
] as const;

const GROUPS: { key: ReportGroup; label: string }[] = [
  { key: 'item', label: 'Item' },
  { key: 'category', label: 'Category' },
  { key: 'area', label: 'Area' },
];

type Figures = InventoryReport['totals'];

const COLUMNS: {
  key: 'used' | 'wasted' | 'short' | 'found' | 'received';
  label: string;
  tone: string;
}[] = [
  { key: 'used', label: 'Used', tone: 'text-[var(--pyre-creme)]' },
  { key: 'wasted', label: 'Wasted', tone: 'text-[var(--pyre-red)]' },
  { key: 'short', label: 'Short', tone: 'text-[var(--pyre-red)]' },
  { key: 'found', label: 'Found', tone: 'text-[var(--pyre-gold)]' },
  { key: 'received', label: 'Received', tone: 'text-[var(--pyre-sage)]' },
];

const cents = (f: Figures, key: (typeof COLUMNS)[number]['key']) =>
  f[`${key}Cents` as keyof Figures] as number;

export function InventoryReports() {
  const [days, setDays] = useState<number>(30);
  const [groupBy, setGroupBy] = useState<ReportGroup>('item');
  // Rounded to the hour so the cache key (and the request) is stable.
  const [to] = useState(() => {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    return now;
  });
  const from = new Date(to.getTime() - days * 86_400_000);
  const url = `/api/admin/inventory-reports?${new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy,
  })}`;
  const { data, error, loading, refreshing } = useCachedJson<InventoryReport>(url);

  const loss = data ? data.totals.wastedCents + data.totals.shortCents : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Period</legend>
          {PERIODS.map((p) => (
            <Chip
              key={p.days}
              selected={days === p.days}
              label={p.label}
              onClick={() => setDays(p.days)}
            />
          ))}
        </fieldset>
        <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true" />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Group by</legend>
          {GROUPS.map((g) => (
            <Chip
              key={g.key}
              selected={groupBy === g.key}
              label={`By ${g.label.toLowerCase()}`}
              onClick={() => setGroupBy(g.key)}
            />
          ))}
        </fieldset>
      </div>

      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}
      {error && !data && <ErrorBanner>Couldn't load the report: {error}</ErrorBanner>}

      {data && (
        <div className={`space-y-6 transition-opacity ${refreshing ? 'opacity-70' : ''}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Used"
              value={formatCents(data.totals.usedCents) || '$0.00'}
              note="everyday consumption"
            />
            <Tile
              label="Loss"
              value={formatCents(loss) || '$0.00'}
              note={`waste ${formatCents(data.totals.wastedCents) || '$0.00'} · short ${formatCents(data.totals.shortCents) || '$0.00'}`}
              tone="text-[var(--pyre-red)]"
            />
            <Tile
              label="Found on count"
              value={formatCents(data.totals.foundCents) || '$0.00'}
              tone="text-[var(--pyre-gold)]"
            />
            <Tile
              label="Received"
              value={formatCents(data.totals.receivedCents) || '$0.00'}
              tone="text-[var(--pyre-sage)]"
            />
          </div>
          <p className="text-xs text-white/40">
            Dollar values use each change's unit cost at the time; items without a cost count in
            units only. Moves between spots, opening balances and admin corrections aren't included.
            {data.truncated &&
              ' This period has more changes than one report reads — choose a shorter period.'}
          </p>

          {data.rows.length === 0 ? (
            <p className="text-sm text-white/50">
              Nothing was used, lost, found, or received in this period.
            </p>
          ) : (
            <>
              {/* Phones: one card per row, every figure visible without
                  sideways scrolling. */}
              <ul className="space-y-2 sm:hidden">
                {data.rows.map((row) => (
                  <ReportCard key={row.key} row={row} />
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded border border-white/10 sm:block">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left font-mono text-[10px] uppercase tracking-wide text-white/40">
                      <th className="px-3 py-2 font-normal">
                        {GROUPS.find((g) => g.key === groupBy)?.label}
                      </th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="px-3 py-2 text-right font-normal">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <ReportTableRow key={row.key} row={row} />
                    ))}
                  </tbody>
                  {groupBy !== 'item' && (
                    <tfoot>
                      <tr className="border-t border-white/10">
                        <td className="px-3 py-2 text-white/50">Total</td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className="px-3 py-2 text-right text-xs text-white/60">
                            {formatCents(cents(data.totals, c.key)) || '—'}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
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

function ReportCard({ row }: { row: ReportRow }) {
  const perItem = row.itemId != null;
  return (
    <li className="rounded border border-white/10 bg-white/[0.03] px-3 py-2.5">
      {perItem ? (
        <a
          href={`/admin/inventory/items/${row.itemId}`}
          className="text-sm text-[var(--pyre-creme)] underline-offset-2 hover:underline"
        >
          {row.label}
        </a>
      ) : (
        <span className="text-sm text-[var(--pyre-creme)]">{row.label}</span>
      )}
      <dl className="mt-1.5 grid grid-cols-5 gap-1 text-center">
        {COLUMNS.map((c) => {
          const units = row[c.key];
          const value = cents(row, c.key);
          const shown = perItem ? units : value;
          return (
            <div key={c.key}>
              <dt className="font-mono text-[9px] uppercase tracking-wide text-white/40">
                {c.label}
              </dt>
              <dd className={`text-sm ${shown ? c.tone : 'text-white/20'}`}>
                {shown ? (perItem ? formatQuantity(units) : formatCents(value)) : '—'}
              </dd>
              {perItem && value > 0 && (
                <dd className="text-[10px] text-white/40">{formatCents(value)}</dd>
              )}
            </div>
          );
        })}
      </dl>
    </li>
  );
}

function ReportTableRow({ row }: { row: ReportRow }) {
  // Units only mean something per item (towels and bottles don't add up).
  const perItem = row.itemId != null;
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="px-3 py-2">
        {perItem ? (
          <a
            href={`/admin/inventory/items/${row.itemId}`}
            className="text-[var(--pyre-creme)] hover:underline"
          >
            {row.label}
          </a>
        ) : (
          <span className="text-[var(--pyre-creme)]">{row.label}</span>
        )}
      </td>
      {COLUMNS.map((c) => {
        const units = row[c.key];
        const value = cents(row, c.key);
        return (
          <td
            key={c.key}
            className="px-3 py-2 text-right"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {perItem ? (
              <>
                <span className={units ? c.tone : 'text-white/20'}>
                  {units ? formatQuantity(units) : '—'}
                </span>
                {value > 0 && (
                  <span className="block text-[11px] text-white/40">{formatCents(value)}</span>
                )}
              </>
            ) : (
              <span className={value ? c.tone : 'text-white/20'}>
                {value ? formatCents(value) : '—'}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
