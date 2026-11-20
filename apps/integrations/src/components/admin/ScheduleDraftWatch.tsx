// A schedule draft Pyre Agent started or revised, drawn under the answer that
// asked for it: "drafting…" while the scheduling agent works (it takes a few
// minutes), then the draft itself — what needs a decision, every item by
// day, and a link to the board. Confirming parts of it is a proposal card
// (AgentActions), so this card only reads (GET /api/admin/schedule-draft).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftItem, ScheduleDraftView } from '@/lib/pyre-agent/schedule';

interface Props {
  weekStart: string;
  /** Bumps when a proposal in the conversation is applied, so the card re-reads the draft. */
  refreshKey: number;
}

/** How often to look again while a draft is being worked on. */
const POLL_MS = 8000;
/** Stop waiting for a draft that has not shown up in this long. */
const GIVE_UP_MS = 20 * 60 * 1000;

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function byDay(items: DraftItem[]): Array<[string, DraftItem[]]> {
  const days = new Map<string, DraftItem[]>();
  for (const item of items) {
    const list = days.get(item.date) ?? [];
    list.push(item);
    days.set(item.date, list);
  }
  return [...days.entries()];
}

export function ScheduleDraftWatch({ weekStart, refreshKey }: Props) {
  const [view, setView] = useState<ScheduleDraftView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  const load = useCallback(async (): Promise<ScheduleDraftView | null> => {
    try {
      const response = await fetch(
        `/api/admin/schedule-draft?weekStart=${encodeURIComponent(weekStart)}`
      );
      const body = (await response.json()) as ScheduleDraftView & { error?: string };
      if (!response.ok) {
        setError(body.error ?? `Could not read the draft (HTTP ${response.status})`);
        return null;
      }
      setError(null);
      setView(body);
      return body;
    } catch {
      setError('Could not read the draft');
      return null;
    }
  }, [weekStart]);

  // Re-read whenever a proposal is applied (items leave the draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the trigger
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const tick = async () => {
      const next = await load();
      if (cancelled) return;
      const waiting = !next || next.inProgress || (!next.draft && !next.last);
      if (waiting && Date.now() - startedAt.current < GIVE_UP_MS) {
        timer = setTimeout(() => void tick(), POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load, refreshKey]);

  const week = weekLabel(weekStart);
  const draft = view?.draft ?? null;

  return (
    <section
      className="mt-3 rounded-lg border border-sky-300/25 bg-sky-300/5 px-3 py-2.5"
      aria-label={`Schedule draft for the week of ${week}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wide text-sky-200/80">
          Schedule draft · week of {week}
        </p>
        {view && (
          <a className="text-xs text-sky-200 underline hover:text-sky-100" href={view.url}>
            Open on the board
          </a>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-[var(--pyre-red)]">{error}</p>}

      {!view && !error && <p className="mt-1 text-sm text-white/60">Checking the draft…</p>}

      {view?.inProgress && (
        <p className="mt-1 animate-pulse text-sm text-[var(--pyre-creme)]">
          {view.inProgress.kind === 'refine' ? 'Revising the draft' : 'Drafting the week'}… this
          usually takes a few minutes. You can leave this page; you will be notified when it is
          ready.
        </p>
      )}

      {view && !view.inProgress && !draft && (
        <p className="mt-1 text-sm text-white/70">
          {view.last
            ? `There is no open draft: the week's latest one was ${view.last.status}.`
            : Date.now() - startedAt.current < GIVE_UP_MS
              ? 'Waiting for the draft…'
              : 'No draft arrived. Try asking again, or draft from the board.'}
        </p>
      )}

      {draft && (
        <div className={view?.inProgress ? 'mt-2 opacity-60' : 'mt-1'}>
          <p className="text-sm text-[var(--pyre-creme)]">
            {draft.items.length} item{draft.items.length === 1 ? '' : 's'} waiting for review
            {draft.uncoveredShifts > 0 &&
              ` · ${draft.uncoveredShifts} shift${draft.uncoveredShifts === 1 ? '' : 's'} left uncovered`}
            {draft.warnings.length > 0 &&
              ` · ${draft.warnings.length} warning${draft.warnings.length === 1 ? '' : 's'}`}
          </p>
          {draft.warnings.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-amber-200/90">
              {draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {draft.items.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-white/60 hover:text-white">
                Show every item
              </summary>
              <div className="mt-1.5 space-y-2">
                {byDay(draft.items).map(([day, items]) => (
                  <ul key={day} className="space-y-0.5 text-xs text-white/75">
                    {items.map((item) => (
                      <li key={item.ref}>{item.line}</li>
                    ))}
                  </ul>
                ))}
              </div>
            </details>
          )}
          <p className="mt-2 text-xs text-white/45">
            Ask for changes, or say what to confirm. Nothing goes live until you apply it.
          </p>
        </div>
      )}
    </section>
  );
}
