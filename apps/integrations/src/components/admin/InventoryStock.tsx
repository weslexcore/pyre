// The stock screen (/admin/inventory): every storage area in walk order with
// what's on its shelves — or, switched to "By category", every category with
// its items, their totals, and where each is kept (a product's sizes or
// flavours gathered under it). Tap an item (or one of its
// spots) to log what happened to it — used, received, wasted, or moved to
// another spot. Each tap writes one ledger
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
  groupStockByCategory,
  lotDescription,
  lotsToUnits,
  lotUnit,
  parseQuantity,
  pluralUnit,
  type StockEntry,
  type StockItem,
  type StockLine,
  type StockProduct,
} from '@/lib/inventory/rules';
import {
  type InventoryAreaRow,
  type InventoryOverview,
  MOVEMENT_DESCRIPTIONS,
  type StaffMovementType,
  WASTE_REASONS,
} from '@/lib/inventory/types';
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
import { Chip, primaryButtonClass, TileButton } from './incidentUi';
import {
  dialogPanelClass,
  INVENTORY_API,
  LowBadge,
  MOVEMENTS_API,
  QuantityStepper,
  takeItemParam,
} from './inventoryUi';
import { Modal } from './Modal';

type StockView = 'area' | 'category';

// The viewer's last choice, so the screen opens the way they left it.
const VIEW_KEY = 'pyre-inventory-stock-view';

const readViewPref = (): StockView => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'category' ? 'category' : 'area';
  } catch {
    return 'area';
  }
};

const writeViewPref = (view: StockView): void => {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode etc. — the toggle still works for the session.
  }
};

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
  // Read after mount: the island is server-rendered, where there is no storage.
  const [view, setView] = useState<StockView>('area');
  useEffect(() => setView(readViewPref()), []);
  // Products opened in the by-category view (all open while searching).
  const [openProducts, setOpenProducts] = useState<Set<string>>(() => new Set());
  const toggleProduct = (id: string) =>
    setOpenProducts((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chooseView = (next: StockView) => {
    setView(next);
    writeViewPref(next);
  };
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
  const byCategory = useMemo(() => (data ? groupStockByCategory(data) : []), [data]);

  // Arriving from the global search (?item=<id>): open that item's log sheet
  // in the spot holding the most of it. An item not placed anywhere yet has
  // no sheet to open, so the list is filtered to it instead.
  const linkedItemId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (linkedItemId.current === undefined) linkedItemId.current = takeItemParam();
    const id = linkedItemId.current;
    // Cached data may predate the item; wait for the refetch to include it.
    const item = data?.items.find((i) => i.id === id);
    if (!id || !item) return;
    linkedItemId.current = null;
    const lines = grouped.flatMap((g) => g.lines).filter((l) => l.item.id === id);
    if (lines.length > 0) {
      setActive(lines.reduce((best, l) => (l.quantity > best.quantity ? l : best)));
    } else {
      setQuery(item.name);
    }
  }, [data, grouped]);
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
  const matches = (entry: { item: StockLine['item']; low: boolean }) =>
    (!lowOnly || entry.low) &&
    (!needle ||
      entry.item.name.toLowerCase().includes(needle) ||
      categoryOf(entry.item).toLowerCase().includes(needle));
  const visible = grouped
    .map((g) => ({ ...g, lines: g.lines.filter(matches) }))
    .filter((g) => g.lines.length > 0 || (!needle && !lowOnly));
  // A product shows while any of its variants match, with just those variants
  // (all of them when the product's own name matches).
  const visibleEntry = (entry: StockEntry): StockEntry | null => {
    if (entry.kind === 'item') return matches(entry) ? entry : null;
    const variants = entry.variants.filter(matches);
    return variants.length > 0 ? { ...entry, variants } : null;
  };
  const visibleCategories = byCategory
    .map((g) => ({
      ...g,
      entries: g.entries.map(visibleEntry).filter((e): e is StockEntry => e !== null),
    }))
    .filter((g) => g.entries.length > 0);
  const areaName = new Map(data?.areas.map((a) => [a.id, a.name]) ?? []);
  const nothingShown = view === 'area' ? visible.length === 0 : visibleCategories.length === 0;

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
      {/* Search on its own full-width row, filters below, so it stays wide
          enough to type into on a phone. */}
      <div className="space-y-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an item…"
          aria-label="Find an item"
          className={`${compactInputClass} w-full sm:max-w-md`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex gap-1">
            <legend className="sr-only">Group by</legend>
            <Chip selected={view === 'area'} label="By area" onClick={() => chooseView('area')} />
            <Chip
              selected={view === 'category'}
              label="By category"
              onClick={() => chooseView('category')}
            />
          </fieldset>
          <Chip
            selected={lowOnly}
            label={`Low only${lowCount ? ` (${lowCount})` : ''}`}
            onClick={() => setLowOnly((v) => !v)}
          />
        </div>
      </div>

      {flash && (
        <p
          role="status"
          className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]"
        >
          {flash}
        </p>
      )}

      {nothingShown && (
        <p className="text-sm text-white/50">
          {lowOnly ? 'Nothing is low right now.' : 'No items match.'}
        </p>
      )}

      {view === 'category' &&
        visibleCategories.map(({ category, entries }) => {
          const headingId = `category-${category?.id ?? 'none'}`;
          return (
            <section key={headingId} aria-labelledby={headingId}>
              <h2
                id={headingId}
                className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
              >
                {category?.name ?? 'Uncategorised'}
              </h2>
              <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
                {entries.map((entry) =>
                  entry.kind === 'item' ? (
                    <CategoryItemRow
                      key={entry.item.id}
                      entry={entry}
                      areaName={(id) => areaName.get(id) ?? ''}
                      onOpen={setActive}
                    />
                  ) : (
                    <ProductRow
                      key={entry.product.id}
                      entry={entry}
                      expanded={Boolean(needle) || lowOnly || openProducts.has(entry.product.id)}
                      onToggle={() => toggleProduct(entry.product.id)}
                      areaName={(id) => areaName.get(id) ?? ''}
                      onOpen={setActive}
                    />
                  )
                )}
              </ul>
            </section>
          );
        })}

      {view === 'area' &&
        visible.map(({ area, lines }) => (
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

/**
 * One item in the by-category view: its total across every spot, and each
 * spot it lives in. Logging is always against one spot, so an item kept in
 * one place opens straight to it; one kept in several offers each spot.
 */
function CategoryItemRow({
  entry,
  label,
  areaName,
  onOpen,
}: {
  entry: StockItem;
  /** Shown in place of the item's name (a variant's own label under its product). */
  label?: string;
  areaName: (areaId: string) => string;
  onOpen: (line: StockLine) => void;
}) {
  const { item, total, low, lines } = entry;
  const only = lines.length === 1 ? lines[0] : null;
  const summary = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--pyre-creme)]">
          {label ?? item.name}
        </span>
        <span className="block truncate text-xs text-white/40">
          {lines.length === 0
            ? 'Not stored in any area yet'
            : [only ? areaName(only.spot.area_id) : null, lotDescription(item)]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </span>
      {low && <LowBadge>Low</LowBadge>}
      <span className="shrink-0 text-right">
        <span className="block text-lg leading-tight text-[var(--pyre-creme)]">
          {formatQuantity(total)}
        </span>
        <span className="block font-mono text-[10px] uppercase text-white/40">
          {item.unit}
          {lines.length > 1 && ' total'}
        </span>
      </span>
    </>
  );

  if (only) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onOpen(only)}
          className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/5"
        >
          {summary}
        </button>
      </li>
    );
  }
  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">{summary}</div>
      {lines.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {lines.map((line) => (
            <button
              key={line.spot.id}
              type="button"
              onClick={() => onOpen(line)}
              aria-label={`${item.name} in ${areaName(line.spot.area_id)}: ${formatUnits(line.quantity, item)}`}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:border-white/30"
            >
              {areaName(line.spot.area_id)}{' '}
              <span className="text-[var(--pyre-creme)]">{formatQuantity(line.quantity)}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * A product in the by-category view: its total across every variant, a
 * one-line breakdown ("S 5 · M 1 · L 4"), and — opened — a row per variant
 * to log against.
 */
function ProductRow({
  entry,
  expanded,
  onToggle,
  areaName,
  onOpen,
}: {
  entry: StockProduct;
  expanded: boolean;
  onToggle: () => void;
  areaName: (areaId: string) => string;
  onOpen: (line: StockLine) => void;
}) {
  const { product, variants, total, low } = entry;
  const unit = variants[0]?.item.unit ?? '';
  const panelId = `product-${product.id}`;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-white/5"
      >
        <span aria-hidden className="w-3 shrink-0 font-mono text-xs text-white/40">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[var(--pyre-creme)]">{product.name}</span>
          <span className="block truncate text-xs text-white/40">
            {variants.map((v) => `${v.item.variant} ${formatQuantity(v.total)}`).join(' · ')}
          </span>
        </span>
        {low && <LowBadge>Low</LowBadge>}
        <span className="shrink-0 text-right">
          <span className="block text-lg leading-tight text-[var(--pyre-creme)]">
            {formatQuantity(total)}
          </span>
          <span className="block font-mono text-[10px] uppercase text-white/40">{unit} total</span>
        </span>
      </button>
      {expanded && (
        <ul id={panelId} className="ml-6 divide-y divide-white/5 border-l border-white/10">
          {variants.map((v) => (
            <CategoryItemRow
              key={v.item.id}
              entry={v}
              label={v.item.variant ?? v.item.name}
              areaName={areaName}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
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
  const [delivery, setDelivery] = useState<DeliveryState>(EMPTY_DELIVERY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const receiving = type === 'receive';
  // A delivery can be all rejects, so receiving accepts 0 good units.
  const parsed =
    receiving && Number(amount) === 0 && amount.trim() !== '' ? 0 : parseQuantity(amount);
  const units =
    parsed == null ? null : receiving && inLots ? lotsToUnits(parsed, item.lot_size) : parsed;
  const rejected = receiving ? rejectedUnits(delivery) : 0;
  const takesOut = type === 'use' || type === 'waste' || type === 'transfer';
  const tooMany = takesOut && units != null && units > onHand;
  const canSubmit =
    units != null &&
    !busy &&
    !tooMany &&
    (receiving ? deliveryReady(delivery) && units + (rejected ?? 0) > 0 : units > 0) &&
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
        ...(receiving ? deliveryBody(delivery) : {}),
        ...(type === 'waste' ? { reason } : {}),
        note: note || undefined,
      });
      const verb = ACTIONS.find((a) => a.type === type)?.verb ?? 'Logged';
      const where =
        type === 'transfer'
          ? ` from ${areaName} to ${areas.find((a) => a.id === toAreaId)?.name ?? ''}`
          : type === 'receive'
            ? ` into ${areaName}`
            : ` from ${areaName}`;
      const rejectedNote =
        receiving && rejected
          ? ` ${formatUnits(rejected, item)} rejected (${deliveryReasons(delivery).join(', ')}).`
          : '';
      await onLogged(`${verb} ${formatUnits(units, item)} of ${item.name}${where}.${rejectedNote}`);
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
            {areaName} · {formatUnits(onHand, item)} here
            {line.total !== onHand && ` · ${formatQuantity(line.total)} in all spots`}
          </p>
          <a
            href={`/admin/inventory/items/${item.id}`}
            className="text-xs text-[var(--pyre-gold)] underline"
          >
            History &amp; chart
          </a>
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
          {receiving
            ? `Accepted — into stock${inLots ? ` (${pluralUnit(2, lotUnit(item))})` : ''}`
            : `How many ${pluralUnit(2, item)}`}
        </label>
        <QuantityStepper
          id={`${titleId}-qty`}
          value={amount}
          onChange={setAmount}
          label="quantity"
          min={receiving ? 0 : undefined}
        />
        {type === 'receive' && hasLots && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip selected={!inLots} label={pluralUnit(2, item)} onClick={() => setInLots(false)} />
            <Chip
              selected={inLots}
              label={lotDescription(item) || 'lots'}
              onClick={() => setInLots(true)}
            />
            {inLots && units != null && (
              <span className="text-xs text-white/50">= {formatUnits(units, item)}</span>
            )}
          </div>
        )}
        {tooMany && (
          <p className="mt-2 text-xs text-[var(--pyre-red)]">
            Only {formatUnits(onHand, item)} here. If the shelf has more, an admin can fix the
            count.
          </p>
        )}
      </div>

      {receiving && (
        <DeliveryFields
          idPrefix={titleId}
          itemId={item.id}
          unit={item}
          value={delivery}
          onChange={setDelivery}
        />
      )}

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
            : receiving && rejected
              ? `Receive ${formatUnits(units, item)} · reject ${formatQuantity(rejected)}`
              : `${ACTIONS.find((a) => a.type === type)?.label} ${formatUnits(units, item)}`}
      </button>
    </Modal>
  );
}
