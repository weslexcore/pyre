// The Count tab (/admin/inventory/count): count what is on the shelves.
//
// Home lists the storage areas (overdue and due first), the open count
// rounds with their progress, and — for admins — the lines waiting on a
// review. From there you either start/continue a round (several areas, can
// stay open for days, several people at once) or count one area on its own.
//
// Counting is blind: a spot nobody has counted yet shows only the item, not
// what the system expects. Each line saves as it is entered; the server
// compares it with the ledger at that moment and posts the difference, so
// usage logged while a count is under way is never mistaken for loss. The
// sheet refreshes every 10 s so people counting together see each other's
// lines. The /api/admin/inventory-counts route is the security boundary.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass, compactInputClass, goldButtonClass, labelClass } from '@/components/admin/ui';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { etStamp, etTime, timeAgo } from '@/lib/client/format';
import { defaultRoundName } from '@/lib/inventory/counts';
import {
  formatCents,
  formatQuantity,
  formatUnits,
  parseQuantity,
  pluralUnit,
} from '@/lib/inventory/rules';
import type {
  AreaDueStatus,
  CountSheet,
  CountSheetRow,
  CountSummary,
  CountsOverview,
  InventoryCountLineRow,
} from '@/lib/inventory/types';
import { personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { primaryButtonClass } from './incidentUi';
import { dialogPanelClass, INVENTORY_API, LowBadge, MOVEMENTS_API } from './inventoryUi';
import { Modal } from './Modal';

const COUNTS_API = '/api/admin/inventory-counts';
const POLL_MS = 10_000;

type View =
  | { kind: 'home' }
  | { kind: 'round'; countId: string }
  | { kind: 'sheet'; areaId: string; countId: string | null; since: string };

const message = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

/** After any count, every inventory view's cached numbers are stale. */
function invalidateAll() {
  invalidateJson(COUNTS_API);
  invalidateJson(INVENTORY_API);
  invalidateJson(MOVEMENTS_API);
}

/** Re-fetch every POLL_MS while the tab is visible, so co-counters stay in step. */
function usePolling(reload: () => Promise<void>) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
}

export function InventoryCount() {
  const [view, setView] = useState<View>({ kind: 'home' });
  // The browser back button steps out of a sheet or round, not off the page.
  const go = useCallback((next: View) => {
    window.history.pushState({ inventoryCount: next }, '');
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = (event.state as { inventoryCount?: View } | null)?.inventoryCount;
      setView(state ?? { kind: 'home' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const back = () => window.history.back();

  if (view.kind === 'sheet') {
    return <Sheet view={view} onBack={back} />;
  }
  if (view.kind === 'round') {
    return (
      <Round
        countId={view.countId}
        onBack={back}
        onCountArea={(areaId) =>
          go({ kind: 'sheet', areaId, countId: view.countId, since: new Date().toISOString() })
        }
      />
    );
  }
  return <Home go={go} />;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<AreaDueStatus, string> = {
  overdue: 'Overdue',
  due: 'Due',
  ok: 'Up to date',
  unscheduled: 'No schedule',
};

const STATUS_TONE: Record<AreaDueStatus, string> = {
  overdue: 'border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]',
  due: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  ok: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  unscheduled: 'border-white/15 bg-white/5 text-white/50',
};

function StatusChip({ status }: { status: AreaDueStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Home({ go }: { go: (view: View) => void }) {
  const { data, error, loading, reload } = useCachedJson<CountsOverview>(COUNTS_API);
  const [starting, setStarting] = useState(false);
  usePolling(reload);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load counts: {error}</ErrorBanner>;
  if (!data) return null;

  const countable = data.areas.filter((a) => a.spotCount > 0);

  return (
    <div className="space-y-8">
      {data.isAdmin && data.review.length > 0 && <ReviewList overview={data} onChanged={reload} />}

      <section aria-labelledby="rounds-heading">
        <div className="mb-3 flex items-center gap-3">
          <h2
            id="rounds-heading"
            className="flex-1 font-mono text-xs uppercase tracking-wide text-white/50"
          >
            Count rounds
          </h2>
          <button
            type="button"
            className={goldButtonClass}
            disabled={countable.length === 0}
            onClick={() => setStarting(true)}
          >
            Start a round
          </button>
        </div>
        {data.rounds.length === 0 ? (
          <p className="text-sm text-white/50">
            No round is open. Start one to count several areas — it can stay open for days while
            different people count different areas.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.rounds.map(({ round, counted, total, people }) => (
              <li key={round.id}>
                <button
                  type="button"
                  onClick={() => go({ kind: 'round', countId: round.id })}
                  className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-3 text-left hover:border-white/30"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 text-sm text-[var(--pyre-creme)]">{round.name}</span>
                    <span className="font-mono text-xs text-white/50">
                      {counted} of {total}
                    </span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full bg-[var(--pyre-sage)]"
                      style={{ width: `${total ? Math.min(100, (counted / total) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="mt-1.5 block text-xs text-white/40">
                    {round.area_ids.length} area{round.area_ids.length === 1 ? '' : 's'} · started{' '}
                    {timeAgo(round.started_at)} by {personName(round.started_by, data.people)}
                    {people.length > 0 &&
                      ` · counting: ${people.map((p) => personName(p, data.people)).join(', ')}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="areas-heading">
        <h2
          id="areas-heading"
          className="mb-3 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          Areas
        </h2>
        {data.areas.length === 0 ? (
          <p className="text-sm text-white/50">No storage areas are set up yet.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
            {data.areas.map(({ area, lastCountedAt, status, spotCount }) => (
              <li key={area.id} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-[var(--pyre-creme)]">{area.name}</span>
                    <StatusChip status={status} />
                  </div>
                  <p className="text-xs text-white/40">
                    {lastCountedAt ? `Last counted ${timeAgo(lastCountedAt)}` : 'Never counted'} ·{' '}
                    {spotCount} item{spotCount === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={spotCount === 0}
                  onClick={() =>
                    go({
                      kind: 'sheet',
                      areaId: area.id,
                      countId: null,
                      since: new Date().toISOString(),
                    })
                  }
                >
                  Count
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {starting && (
        <StartRoundDialog
          overview={data}
          onClose={() => setStarting(false)}
          onStarted={(countId) => {
            setStarting(false);
            invalidateAll();
            go({ kind: 'round', countId });
          }}
        />
      )}
    </div>
  );
}

function StartRoundDialog({
  overview,
  onClose,
  onStarted,
}: {
  overview: CountsOverview;
  onClose: () => void;
  onStarted: (countId: string) => void;
}) {
  const countable = overview.areas.filter((a) => a.spotCount > 0);
  const [name, setName] = useState(() => defaultRoundName(new Date()));
  // Every area with something to count, by default: a full count.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(countable.map((a) => a.area.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // Keep the walk order, whatever order they were ticked in.
      const areaIds = [...countable]
        .sort((a, b) => a.area.sort_order - b.area.sort_order)
        .map((a) => a.area.id)
        .filter((id) => chosen.has(id));
      const { round } = await sendJson<{ round: { id: string } }>(COUNTS_API, 'POST', {
        action: 'start',
        name,
        areaIds,
      });
      onStarted(round.id);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      labelledBy="start-round"
      onClose={onClose}
      initialFocus={closeRef}
      panelClassName={dialogPanelClass}
    >
      <div className="mb-4 flex items-start gap-3">
        <h2 id="start-round" className="flex-1 text-lg text-[var(--pyre-creme)]">
          Start a count round
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} className={buttonClass}>
          Close
        </button>
      </div>
      <label className="mb-4 block">
        <span className={labelClass}>Name</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={`${compactInputClass} w-full`}
        />
      </label>
      <fieldset className="mb-4">
        <legend className={labelClass}>Areas to count</legend>
        <div className="mb-2 flex gap-3 text-xs">
          <button
            type="button"
            className="text-white/50 underline"
            onClick={() => setChosen(new Set(countable.map((a) => a.area.id)))}
          >
            All
          </button>
          <button
            type="button"
            className="text-white/50 underline"
            onClick={() =>
              setChosen(
                new Set(
                  countable
                    .filter((a) => a.status === 'due' || a.status === 'overdue')
                    .map((a) => a.area.id)
                )
              )
            }
          >
            Only due
          </button>
        </div>
        <ul className="space-y-2">
          {countable.map(({ area, status }) => (
            <li key={area.id}>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={chosen.has(area.id)}
                  onChange={() => toggle(area.id)}
                />
                <span className="flex-1">{area.name}</span>
                <StatusChip status={status} />
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <button
        type="button"
        disabled={busy || !name.trim() || chosen.size === 0}
        onClick={start}
        className={`${primaryButtonClass} w-full`}
      >
        {busy ? 'Starting…' : `Start counting ${chosen.size} area${chosen.size === 1 ? '' : 's'}`}
      </button>
    </Modal>
  );
}

/** Admins: lines over the review threshold, to accept or send back. */
function ReviewList({
  overview,
  onChanged,
}: {
  overview: CountsOverview;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (lineId: string, decision: 'accept' | 'recount') => {
    setBusyId(lineId);
    setError(null);
    try {
      await sendJson(COUNTS_API, 'PATCH', { action: 'review', lineId, decision });
      invalidateAll();
      await onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="review-heading">
      <h2
        id="review-heading"
        className="mb-1 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]"
      >
        Needs review ({overview.review.length})
      </h2>
      <p className="mb-3 text-xs text-white/40">
        Off by more than {formatQuantity(overview.settings.review_pct)}% or{' '}
        {formatCents(overview.settings.review_cents)}. Stock already reflects the count; asking for
        a recount flags the line for whoever counts that area next.
      </p>
      {error && <ErrorBanner className="mb-3">{error}</ErrorBanner>}
      <ul className="divide-y divide-white/5 rounded border border-[var(--pyre-gold)]/30 bg-white/[0.03]">
        {overview.review.map((line) => (
          <li key={line.id} className="px-3 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-[var(--pyre-creme)]">{line.itemName}</span>
              <span className="text-xs text-white/40">{line.areaName}</span>
              {line.review_status === 'recount' && <LowBadge>Recount asked</LowBadge>}
            </div>
            <p className="text-xs text-white/60">
              Expected {formatQuantity(line.expected_qty)}, counted{' '}
              {formatUnits(line.counted_qty, line)} → <Variance line={line} />
            </p>
            <p className="text-xs text-white/40">
              {personName(line.counted_by, overview.people)} · {etStamp(line.counted_at)}
            </p>
            {line.review_status === 'pending' && (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={goldButtonClass}
                  disabled={busyId === line.id}
                  onClick={() => decide(line.id, 'accept')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busyId === line.id}
                  onClick={() => decide(line.id, 'recount')}
                >
                  Ask for recount
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "−2 (−$5.00)" / "+3" / "matches", toned by direction. */
function Variance({ line }: { line: Pick<InventoryCountLineRow, 'variance' | 'variance_cents'> }) {
  if (line.variance === 0) return <span className="text-[var(--pyre-sage)]">matches</span>;
  const short = line.variance < 0;
  return (
    <span className={short ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-gold)]'}>
      {short ? '−' : '+'}
      {formatQuantity(Math.abs(line.variance))}
      {line.variance_cents != null && ` (${formatCents(Math.abs(line.variance_cents))})`}
      {short ? ' short' : ' found'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------

function Round({
  countId,
  onBack,
  onCountArea,
}: {
  countId: string;
  onBack: () => void;
  onCountArea: (areaId: string) => void;
}) {
  const { data, error, loading, reload } = useCachedJson<CountSummary>(
    `${COUNTS_API}?summary=${countId}`
  );
  const overview = useCachedJson<CountsOverview>(COUNTS_API);
  const [confirming, setConfirming] = useState<'close' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  usePolling(reload);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load the round: {error}</ErrorBanner>;
  if (!data) return null;

  const { round, areas, lines, notCounted, totals } = data;
  const open = round.status === 'open';
  const isAdmin = overview.data?.isAdmin ?? false;

  const finish = async (action: 'close' | 'cancel') => {
    setBusy(true);
    setActionError(null);
    try {
      await sendJson(COUNTS_API, 'PATCH', { action, id: round.id });
      invalidateAll();
      setConfirming(null);
      await reload();
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <BackButton onClick={onBack} label="All counts" />
      <div>
        <h2 className="text-xl text-[var(--pyre-creme)]">{round.name}</h2>
        <p className="text-xs text-white/40">
          Started {etStamp(round.started_at)} by {personName(round.started_by, data.people)}
          {!open &&
            round.closed_at &&
            ` · ${round.status} ${etStamp(round.closed_at)}${round.closed_by ? ` by ${personName(round.closed_by, data.people)}` : ''}`}
        </p>
      </div>

      <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
        {areas.map(({ area, counted, total }) => (
          <li key={area.id} className="flex items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[var(--pyre-creme)]">{area.name}</p>
              <p className="text-xs text-white/40">
                {counted >= total && total > 0 ? '✓ ' : ''}
                {counted} of {total} counted
              </p>
            </div>
            {open && (
              <button
                type="button"
                className={counted < total ? goldButtonClass : buttonClass}
                onClick={() => onCountArea(area.id)}
              >
                {counted === 0 ? 'Count' : counted < total ? 'Continue' : 'Review'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <section aria-labelledby="results-heading">
        <h3
          id="results-heading"
          className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
        >
          {open ? 'Results so far' : 'Results'}
        </h3>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded border border-white/10 bg-white/[0.03] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">Short</p>
            <p className="text-lg text-[var(--pyre-red)]">{formatQuantity(totals.shortUnits)}</p>
            <p className="text-xs text-white/40">{formatCents(totals.shortCents) || '$0.00'}</p>
          </div>
          <div className="rounded border border-white/10 bg-white/[0.03] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">Found</p>
            <p className="text-lg text-[var(--pyre-gold)]">{formatQuantity(totals.foundUnits)}</p>
            <p className="text-xs text-white/40">{formatCents(totals.foundCents) || '$0.00'}</p>
          </div>
        </div>
        {lines.some((l) => l.variance !== 0) && (
          <ul className="space-y-1 text-sm">
            {lines
              .filter((l) => l.variance !== 0)
              .map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-2 text-white/70">
                  <span className="text-[var(--pyre-creme)]">{l.itemName}</span>
                  <span className="text-white/40">{l.areaName}</span>
                  <Variance line={l} />
                  {l.review_status === 'pending' && <LowBadge>Review</LowBadge>}
                  {l.review_status === 'recount' && <LowBadge>Recount</LowBadge>}
                </li>
              ))}
          </ul>
        )}
        {notCounted.length > 0 && (
          <p className="mt-3 text-xs text-white/50">
            Not counted ({notCounted.length}):{' '}
            {notCounted.map((n) => `${n.itemName} (${n.areaName})`).join(', ')}.{' '}
            {open ? '' : 'Their stock was left as it was.'}
          </p>
        )}
      </section>

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {open && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => setConfirming('close')}
          >
            Close round
          </button>
          {isAdmin && (
            <button type="button" className={buttonClass} onClick={() => setConfirming('cancel')}>
              Cancel round
            </button>
          )}
        </div>
      )}

      {confirming && (
        <Modal
          labelledBy="confirm-round"
          onClose={() => setConfirming(null)}
          panelClassName={dialogPanelClass}
        >
          <h2 id="confirm-round" className="mb-2 text-lg text-[var(--pyre-creme)]">
            {confirming === 'close' ? 'Close this round?' : 'Cancel this round?'}
          </h2>
          <p className="mb-4 text-sm text-white/60">
            {confirming === 'close'
              ? notCounted.length > 0
                ? `${notCounted.length} item spot${notCounted.length === 1 ? ' was' : 's were'} not counted; their stock stays as it is.`
                : 'Every spot was counted.'
              : 'Lines already counted keep their adjustments — they were real shelf counts. Nobody can add more to this round.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className={`${primaryButtonClass} flex-1`}
              onClick={() => finish(confirming)}
            >
              {busy ? 'Saving…' : confirming === 'close' ? 'Close round' : 'Cancel round'}
            </button>
            <button type="button" className={buttonClass} onClick={() => setConfirming(null)}>
              Back
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-xs uppercase tracking-wide text-white/50 hover:text-white"
    >
      ← {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Counting sheet
// ---------------------------------------------------------------------------

function Sheet({ view, onBack }: { view: Extract<View, { kind: 'sheet' }>; onBack: () => void }) {
  const url = useMemo(() => {
    const params = new URLSearchParams({ areaId: view.areaId });
    if (view.countId) params.set('countId', view.countId);
    else params.set('since', view.since);
    return `${COUNTS_API}?${params}`;
  }, [view]);
  const { data, error, loading, reload, setData } = useCachedJson<CountSheet>(url);
  usePolling(reload);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load the area: {error}</ErrorBanner>;
  if (!data) return null;

  const counted = data.rows.filter((r) => r.line).length;
  const closed = data.round && data.round.status !== 'open';

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} label={data.round ? data.round.name : 'All counts'} />
      <div>
        <h2 className="text-xl text-[var(--pyre-creme)]">{data.area.name}</h2>
        <p className="text-xs text-white/40">
          {data.round ? data.round.name : 'Counting this area on its own'} · {counted} of{' '}
          {data.rows.length} counted
        </p>
        {data.area.description && (
          <p className="mt-1 text-xs text-white/50">{data.area.description}</p>
        )}
      </div>
      <p className="text-xs text-white/50">
        Count what's on the shelf and save each line. You'll see whether it matched after saving.
      </p>
      {closed && (
        <ErrorBanner>This round is {data.round?.status}; it can't be changed.</ErrorBanner>
      )}
      {data.rows.length === 0 ? (
        <p className="text-sm text-white/50">No items are kept here.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded border border-white/10 bg-white/[0.03]">
          {data.rows.map((row) => (
            <SheetLine
              key={row.itemId}
              row={row}
              areaId={data.area.id}
              countId={view.countId}
              disabled={!!closed}
              people={data.people}
              onSaved={(line) => {
                // Show it at once; the next poll brings everyone else's.
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        rows: prev.rows.map((r) => (r.itemId === row.itemId ? { ...r, line } : r)),
                      }
                    : prev
                );
                invalidateAll();
              }}
            />
          ))}
        </ul>
      )}
      <button type="button" className={buttonClass} onClick={onBack}>
        Done with this area
      </button>
    </div>
  );
}

function SheetLine({
  row,
  areaId,
  countId,
  disabled,
  people,
  onSaved,
}: {
  row: CountSheetRow;
  areaId: string;
  countId: string | null;
  disabled: boolean;
  people: Record<string, string>;
  onSaved: (line: InventoryCountLineRow) => void;
}) {
  const { line } = row;
  // Asked on this line, or on an earlier count of this spot (possibly in a
  // round that has since closed) that this sheet hasn't recounted yet.
  const recount = line ? line.review_status === 'recount' : row.recountAsked;
  const [editing, setEditing] = useState(!line || recount);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Someone else saved this line (seen on a poll) while it was untouched here.
  useEffect(() => {
    if (line && !recount && value === '') setEditing(false);
  }, [line, recount, value]);

  const amount = value.trim() === '0' ? 0 : parseQuantity(value);

  const save = async () => {
    if (amount == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { line: saved } = await sendJson<{ line: InventoryCountLineRow }>(COUNTS_API, 'POST', {
        action: 'line',
        countId,
        itemId: row.itemId,
        areaId,
        counted: amount,
      });
      setValue('');
      setEditing(false);
      onSaved(saved);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`px-3 py-3 ${recount ? 'bg-[var(--pyre-red)]/5' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[var(--pyre-creme)]">{row.name}</p>
          <p className="truncate text-xs text-white/40">
            {[row.category, `counted in ${pluralUnit(2, row)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
        {editing && !disabled ? (
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              inputMode="decimal"
              enterKeyHint="next"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
              aria-label={`How many ${row.name}`}
              placeholder="#"
              className="h-11 w-20 rounded border border-white/15 bg-white/5 text-center text-lg text-[var(--pyre-creme)] focus:border-white/40 focus:outline-none"
            />
            <button type="submit" disabled={amount == null || busy} className={goldButtonClass}>
              {busy ? '…' : 'Save'}
            </button>
          </form>
        ) : (
          line && (
            <div className="shrink-0 text-right">
              <p className="text-lg leading-tight text-[var(--pyre-creme)]">
                ✓ {formatQuantity(line.counted_qty)}
              </p>
              {!disabled && (
                <button
                  type="button"
                  className="font-mono text-[10px] uppercase tracking-wide text-white/40 underline"
                  onClick={() => setEditing(true)}
                >
                  Recount
                </button>
              )}
            </div>
          )
        )}
      </div>
      {line && (
        <p className="mt-1 text-xs text-white/50">
          {formatUnits(line.counted_qty, row)} · <Variance line={line} /> ·{' '}
          {personName(line.counted_by, people)} {etTime(line.counted_at)}
          {line.review_status === 'pending' && ' · an admin will review this'}
        </p>
      )}
      {recount && (
        <p className="mt-1 text-xs text-[var(--pyre-red)]">
          An admin asked for this to be counted again.
        </p>
      )}
      {error && <ErrorBanner className="mt-2">{error}</ErrorBanner>}
    </li>
  );
}
