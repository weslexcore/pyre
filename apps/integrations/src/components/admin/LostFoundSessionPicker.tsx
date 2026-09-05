// Sending the "is this yours?" blast to whole sessions, from the item page.
//
// This is the one screen in the tool that can email dozens of strangers, so it
// is built to make that deliberate rather than easy: the count of people about
// to be emailed is stated in words next to the button, and the button says how
// many. The sessions themselves come from the shared chooser.
//
// What is pre-selected is whatever staff picked when they logged the item —
// their own answer to "which sessions could this have been left in?", made at
// the desk minutes earlier with the bottle in hand. Carrying it forward saves
// asking the same question twice; it does not send anything, and the count in
// the button still has to be read before the press.

import { useEffect, useMemo, useState } from 'react';
import { buttonClass, primaryButtonClass, readError } from './incidentUi';
import { countReachable, SessionChoices, useSessionChoices } from './LostFoundSessionChoices';

export function LostFoundSessionPicker({
  itemId,
  windowStart,
  windowEnd,
  chosenSessionIds,
  alreadyAsked,
  onSent,
}: {
  itemId: string;
  windowStart: string;
  windowEnd: string;
  /** Sessions picked when the item was logged. Pre-selected, never sent. */
  chosenSessionIds: string[];
  /** Masked addresses we've already emailed about this item. */
  alreadyAsked: Set<string>;
  onSent: (summary: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(chosenSessionIds));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, sessions, hiddenCount } = useSessionChoices(windowStart, windowEnd);

  // The item arrives with the page, so the first render of this component
  // already has the log-time choice; a later reload only re-seeds if the stored
  // choice itself changed, so it never fights a staff member mid-selection.
  const chosenKey = chosenSessionIds.join(',');
  useEffect(() => {
    setPicked(new Set(chosenKey ? chosenKey.split(',') : []));
  }, [chosenKey]);

  const reachable = useMemo(
    () => countReachable(sessions, picked, alreadyAsked),
    [sessions, picked, alreadyAsked]
  );

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/lost-found-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, mode: 'sessions', sessionIds: [...picked] }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const result = (await res.json()) as {
        sent: number;
        alreadyAsked: number;
        failed: number;
      };
      setPicked(new Set());
      onSent(
        `Asked ${result.sent} ${result.sent === 1 ? 'person' : 'people'}` +
          (result.alreadyAsked > 0 ? `, ${result.alreadyAsked} already asked` : '') +
          (result.failed > 0 ? `, ${result.failed} failed` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  };

  const nothingToPick = !loading && data?.available !== false && sessions.length === 0;

  return (
    <div className="space-y-3">
      <SessionChoices
        data={data}
        loading={loading}
        sessions={sessions}
        hiddenCount={hiddenCount}
        picked={picked}
        alreadyAsked={alreadyAsked}
        onToggle={toggle}
        emptyHint="Nobody to ask about this one."
      />

      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      {!nothingToPick && (
        <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={sending || reachable === 0}
            onClick={() => void send()}
          >
            {sending
              ? 'Sending…'
              : reachable === 0
                ? 'Pick a session'
                : `Ask ${reachable} ${reachable === 1 ? 'person' : 'people'}`}
          </button>
          {picked.size > 0 && (
            <button type="button" className={buttonClass} onClick={() => setPicked(new Set())}>
              Clear
            </button>
          )}
          <span className="text-xs text-white/40">
            Each person is asked once about this item, however many sessions they were in.
          </span>
        </div>
      )}
    </div>
  );
}
