// The stock screen (/admin/inventory): every storage area in walk order with
// what's on its shelves. Tap an item to log what happened to it — used,
// received, wasted, or moved to another spot. Each tap writes one ledger
// row, so several people can log at once without overwriting each other.
//
// Totals across spots drive the Low badge (re-order level reached). The
// /api/admin/inventory-movements route is the security boundary; this island
// only offers what the viewer may do.

import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass, compactInputClass, labelClass } from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import {
  formatQuantity,
  formatUnits,
  groupStockByArea,
  lotDescription,
  lotsToUnits,
  parseQuantity,
  pluralUnit,
  type StockLine,
} from '@/lib/inventory/rules';
import {
  type InventoryAreaRow,
  type InventoryOverview,
  MOVEMENT_DESCRIPTIONS,
  type StaffMovementType,
  WASTE_REASONS,
} from '@/lib/inventory/types';
import { ErrorBanner } from './ErrorBanner';
import { Chip, primaryButtonClass, TileButton } from './incidentUi';
import {
  dialogPanelClass,
  INVENTORY_API,
  LowBadge,
  MOVEMENTS_API,
  QuantityStepper,
} from './inventoryUi';
import { Modal } from './Modal';

const ACTIONS: { type: StaffMovementType; label: string; verb: string }[] = [
  { type: 'use', label: 'Use', verb: 'Used' },
  { type: 'receive', label: 'Receive', verb: 'Received' },
  { type: 'waste', label: 'Waste', verb: 'Wasted' },
  { type: 'transfer', label: 'Move', verb: 'Moved' },
];

export function InventoryStock() {
  const { data, error, loading, reload } = useCachedJson<InventoryOverview>(INVENTORY_API);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [active, setActive] = useState<StockLine | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Someone else may have logged since this tab loaded; refresh when the
  // tab comes back into view, which is when staff pick the phone back up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timer);
  }, [flash]);

  const grouped = useMemo(() => (data ? groupStockByArea(data) : []), [data]);
  const categoryName = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c.name])),
    [data?.categories]
  );
  const categoryOf = (item: { category_id: string | null }) =>
    item.category_id ? (categoryName.get(item.category_id) ?? '') : '';
  const lowCount = useMemo(() => {
    const low = new Set<string>();
    for (const g of grouped) for (const l of g.lines) if (l.low) low.add(l.item.id);
    return low.size;
  }, [grouped]);

  const needle = query.trim().toLowerCase();
  const visible = grouped
    .map((g) => ({
      ...g,
      lines: g.lines.filter(
        (l) =>
          (!lowOnly || l.low) &&
          (!needle ||
            l.item.name.toLowerCase().includes(needle) ||
            categoryOf(l.item).toLowerCase().includes(needle))
      ),
    }))
    .filter((g) => g.lines.length > 0 || (!needle && !lowOnly));

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load inventory: {error}</ErrorBanner>;
  if (!data) return null;

  const activeAreas = data.areas.filter((a) => a.active);
  if (activeAreas.length === 0 || !data.items.some((i) => i.active)) {
    return (
      <div className="rounded border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60">
        <p>Nothing is set up yet.</p>
        {data.isAdmin ? (
          <p className="mt-2">
            Add storage areas and items on the{' '}
            <a href="/admin/inventory/setup" className="text-[var(--pyre-gold)] underline">
              Setup
            </a>{' '}
            tab.
          </p>
        ) : (
          <p className="mt-2">An admin needs to add storage areas and items first.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an item…"
          aria-label="Find an item"
          className={`${compactInputClass} min-w-0 flex-1 sm:max-w-xs`}
        />
        <Chip
          selected={lowOnly}
          label={`Low only${lowCount ? ` (${lowCount})` : ''}`}
          onClick={() => setLowOnly((v) => !v)}
        />
      </div>

      {flash && (
        <p
          role="status"
          className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]"
        >
          {flash}
        </p>
      )}

      {visible.length === 0 && (
        <p className="text-sm text-white/50">
          {lowOnly ? 'Nothing is low right now.' : 'No items match.'}
        </p>
      )}

      {visible.map(({ area, lines }) => (
        <section key={area.id} aria-labelledby={`area-${area.id}`}>
          <h2
            id={`area-${area.id}`}
            className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
          >
            {area.name}
            {area.description && (
              <span className="ml-2 normal-case tracking-normal text-white/30">
                {area.description}
              </span>
            )}
          </h2>
          {lines.length === 0 ? (
            <p className="rounded border border-dashed border-white/10 px-3 py-3 text-xs text-white/40">
              No items stored here yet.
            </p>
          ) : (
            <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
              {lines.map((line) => (
                <li key={line.spot.id}>
                  <button
                    type="button"
                    onClick={() => setActive(line)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--pyre-creme)]">
                        {line.item.name}
                      </span>
                      <span className="block truncate text-xs text-white/40">
                        {[categoryOf(line.item), lotDescription(line.item)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {line.low && <LowBadge>Low · {formatQuantity(line.total)} total</LowBadge>}
                    <span className="shrink-0 text-right">
                      <span className="block text-lg leading-tight text-[var(--pyre-creme)]">
                        {formatQuantity(line.quantity)}
                      </span>
                      <span className="block font-mono text-[10px] uppercase text-white/40">
                        {line.item.unit}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {active && (
        <LogDialog
          line={active}
          areas={activeAreas}
          onClose={() => setActive(null)}
          onLogged={async (message) => {
            setActive(null);
            setFlash(message);
            invalidateJson(INVENTORY_API);
            invalidateJson(MOVEMENTS_API);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function LogDialog({
  line,
  areas,
  onClose,
  onLogged,
}: {
  line: StockLine;
  areas: InventoryAreaRow[];
  onClose: () => void;
  onLogged: (message: string) => Promise<void>;
}) {
  const { item, spot, quantity: onHand } = line;
  const hasLots = item.lot_size !== 1;
  const otherAreas = areas.filter((a) => a.id !== spot.area_id);
  const areaName = areas.find((a) => a.id === spot.area_id)?.name ?? '';

  const [type, setType] = useState<StaffMovementType>('use');
  const [amount, setAmount] = useState('1');
  const [inLots, setInLots] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [toAreaId, setToAreaId] = useState(otherAreas[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const parsed = parseQuantity(amount);
  const units =
    parsed == null
      ? null
      : type === 'receive' && inLots
        ? lotsToUnits(parsed, item.lot_size)
        : parsed;
  const takesOut = type === 'use' || type === 'waste' || type === 'transfer';
  const tooMany = takesOut && units != null && units > onHand;
  const canSubmit =
    units != null &&
    !busy &&
    !tooMany &&
    (type !== 'waste' || reason.trim() !== '') &&
    (type !== 'transfer' || toAreaId !== '');

  const submit = async () => {
    if (!canSubmit || parsed == null || units == null) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(MOVEMENTS_API, 'POST', {
        type,
        itemId: item.id,
        areaId: spot.area_id,
        ...(type === 'receive' && inLots ? { lots: parsed } : { quantity: parsed }),
        ...(type === 'transfer' ? { toAreaId } : {}),
        reason: type === 'waste' ? reason : undefined,
        note: note || undefined,
      });
      const verb = ACTIONS.find((a) => a.type === type)?.verb ?? 'Logged';
      const where =
        type === 'transfer'
          ? ` from ${areaName} to ${areas.find((a) => a.id === toAreaId)?.name ?? ''}`
          : type === 'receive'
            ? ` into ${areaName}`
            : ` from ${areaName}`;
      await onLogged(`${verb} ${formatUnits(units, item.unit)} of ${item.name}${where}.`);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const titleId = `log-${spot.id}`;
  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={dialogPanelClass}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg text-[var(--pyre-creme)]">
            {item.name}
          </h2>
          <p className="text-xs text-white/50">
            {areaName} · {formatUnits(onHand, item.unit)} here
            {line.total !== onHand && ` · ${formatQuantity(line.total)} in all spots`}
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>

      <fieldset className="mb-4 grid grid-cols-4 gap-2">
        <legend className="sr-only">What happened</legend>
        {ACTIONS.filter((a) => a.type !== 'transfer' || otherAreas.length > 0).map((a) => (
          <TileButton
            key={a.type}
            selected={type === a.type}
            label={a.label}
            onClick={() => {
              setType(a.type);
              setError(null);
            }}
          />
        ))}
      </fieldset>
      <p className="mb-4 text-xs text-white/45">{MOVEMENT_DESCRIPTIONS[type]}</p>

      <div className="mb-4">
        <label htmlFor={`${titleId}-qty`} className={labelClass}>
          {type === 'receive' && inLots
            ? `How many ${pluralUnit(2, item.lot_label || 'lot')}`
            : `How many ${pluralUnit(2, item.unit)}`}
        </label>
        <QuantityStepper
          id={`${titleId}-qty`}
          value={amount}
          onChange={setAmount}
          label="quantity"
        />
        {type === 'receive' && hasLots && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip selected={!inLots} label={`${item.unit}s`} onClick={() => setInLots(false)} />
            <Chip
              selected={inLots}
              label={lotDescription(item) || 'lots'}
              onClick={() => setInLots(true)}
            />
            {inLots && units != null && (
              <span className="text-xs text-white/50">= {formatUnits(units, item.unit)}</span>
            )}
          </div>
        )}
        {tooMany && (
          <p className="mt-2 text-xs text-[var(--pyre-red)]">
            Only {formatUnits(onHand, item.unit)} here. If the shelf has more, an admin can fix the
            count.
          </p>
        )}
      </div>

      {type === 'transfer' && (
        <div className="mb-4">
          <label htmlFor={`${titleId}-to`} className={labelClass}>
            Move to
          </label>
          <div id={`${titleId}-to`} className="flex flex-wrap gap-2">
            {otherAreas.map((a) => (
              <Chip
                key={a.id}
                selected={toAreaId === a.id}
                label={a.name}
                onClick={() => setToAreaId(a.id)}
              />
            ))}
          </div>
        </div>
      )}

      {type === 'waste' && (
        <div className="mb-4">
          <label htmlFor={`${titleId}-reason`} className={labelClass}>
            Why
          </label>
          <div className="mb-2 flex flex-wrap gap-2">
            {WASTE_REASONS.map((r) => (
              <Chip key={r} selected={reason === r} label={r} onClick={() => setReason(r)} />
            ))}
          </div>
          <input
            id={`${titleId}-reason`}
            value={reason}
            maxLength={120}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Or say why"
            className={`${compactInputClass} w-full`}
          />
        </div>
      )}

      <div className="mb-4">
        <label htmlFor={`${titleId}-note`} className={labelClass}>
          Note (optional)
        </label>
        <input
          id={`${titleId}-note`}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          className={`${compactInputClass} w-full`}
        />
      </div>

      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={`${primaryButtonClass} w-full`}
      >
        {busy
          ? 'Saving…'
          : units == null
            ? 'Enter a quantity'
            : `${ACTIONS.find((a) => a.type === type)?.label} ${formatUnits(units, item.unit)}`}
      </button>
    </Modal>
  );
}
