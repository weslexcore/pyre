// The trail and the thread, in one column. Mechanical events — moved,
// assigned, measured, completed — and the comments people write sit in the
// same list in the order they happened, because "Julien moved this to
// Quoted" and "Julien said the deposit cleared" are the same story and
// splitting them into two panels makes neither readable.
//
// Reads from /api/admin/board-events; posting a comment is the one write.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardColumnRow, BoardEventRow } from '@/lib/db';
import { describeEvent, timeAgo } from '@/lib/goals/history';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { buttonClass, SectionTitle, send, textareaClass } from '../goalsUi';
import { readError } from '../incidentUi';

interface EventsResponse {
  events: BoardEventRow[];
  people?: PeopleNames;
}

export function ActivityFeed({
  cardId,
  goalId,
  subjectTitle,
  columns,
  people,
  heading = 'Activity',
}: {
  /** Exactly one of these; it decides which trail is read and commented on. */
  cardId?: string;
  goalId?: string;
  subjectTitle: string;
  columns: BoardColumnRow[];
  people: PeopleNames;
  heading?: string;
}) {
  const [events, setEvents] = useState<BoardEventRow[]>([]);
  const [names, setNames] = useState<PeopleNames>(people);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = cardId ? `cardId=${cardId}` : goalId ? `goalId=${goalId}` : '';

  const load = useCallback(async () => {
    if (!query) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/board-events?${query}`);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as EventsResponse;
      setEvents(body.events);
      setNames({ ...people, ...(body.people ?? {}) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the activity');
    } finally {
      setLoading(false);
    }
  }, [query, people]);

  useEffect(() => {
    void load();
  }, [load]);

  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const nowIso = new Date().toISOString();

  const comment = async (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await send('/api/admin/board-events', 'POST', { cardId, goalId, note: body });
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionTitle note={events.length > 0 ? `${events.length} entries` : undefined}>
        {heading}
      </SectionTitle>

      <form onSubmit={comment} className="mb-3">
        <label className="sr-only" htmlFor={`comment-${cardId ?? goalId}`}>
          Add a comment
        </label>
        <textarea
          id={`comment-${cardId ?? goalId}`}
          className={`${textareaClass} min-h-[70px]`}
          maxLength={BOARD_LIMITS.comment}
          placeholder="Add a note for whoever reads this next…"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <button type="submit" className={buttonClass} disabled={busy || !note.trim()}>
            {busy ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>

      {error && <p className="mb-2 text-sm text-[var(--pyre-red)]">{error}</p>}
      {loading && events.length === 0 && (
        <p className="font-mono text-xs text-white/35">Loading…</p>
      )}
      {!loading && events.length === 0 && (
        <p className="font-mono text-xs text-white/35">Nothing has happened here yet.</p>
      )}

      <ol className="space-y-2">
        {[...events].reverse().map((entry) => (
          <li key={entry.id} className="flex gap-2 text-sm">
            <span className="shrink-0 font-mono text-[11px] text-white/30">
              {timeAgo(entry.created_at, nowIso)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-[var(--pyre-creme)]">{personName(entry.actor, names)}</span>{' '}
              <span className={entry.action === 'comment' ? 'text-white/80' : 'text-white/45'}>
                {describeEvent(entry, subjectTitle, columnsById, names)}
              </span>
              {entry.action !== 'comment' && entry.note && (
                <span className="mt-1 block whitespace-pre-wrap text-white/60">{entry.note}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
