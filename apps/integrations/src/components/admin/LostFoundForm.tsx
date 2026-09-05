// Logging something a guest left behind.
//
// The photo comes first and does most of the work. A staff member closing up
// has a bottle in one hand and a phone in the other; "take a picture, say what
// it is" is the whole interaction, and everything below the fold has a
// sensible default. The picture is also what a guest recognises in an email —
// no wording beats seeing your own jacket.
//
// Then the question that decides everything downstream: do we know whose it
// is? A name means one email to one person and there is nothing else to
// decide. Without one, the question is which sessions this could have been
// left in — asked as sessions, with names and headcounts, not as clock times.
// The person logging it was there: they know the 6pm social had just let out.
// Nobody knows, off the top of their head, that the window they want is 15:00
// to 21:00, and the times were only ever a way of naming those sessions.
//
// The choice is stored on the item and pre-selected on the item page, so the
// send is still a second, deliberate act — but not a second answering of the
// same question.

import { useMemo, useState } from 'react';
import { invalidateJson } from '@/lib/client/cachedJson';
import type { LostFoundItemRow } from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  MAX_ATTACHMENTS_PER_ITEM,
} from '@/lib/lost-found/media';
import {
  DEFAULT_LOOKBACK_HOURS,
  DONATION_PARTNER,
  DONATION_WINDOW_DAYS,
  guestItemClause,
  MAX_WINDOW_HOURS,
} from '@/lib/lost-found/types';
import { FIELD_LIMITS } from '@/lib/lost-found/validate';
import { type PersonResult, useGuestSearch } from './GuestSearch';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  readError,
  SectionTitle,
} from './incidentUi';
import { SessionChoices, useSessionChoices } from './LostFoundSessionChoices';

/** The log form has never emailed anyone yet, so nothing is "already asked". */
const EMPTY_ASKED: Set<string> = new Set();

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
}

/** How far back the session list reaches, and each widening of it. */
const LOOKBACK_STEPS = [DEFAULT_LOOKBACK_HOURS, 12, 24, 48, MAX_WINDOW_HOURS];

export function LostFoundForm() {
  const now = useMemo(() => new Date(), []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [storageLocation, setStorageLocation] = useState('');
  const [lookbackHours, setLookbackHours] = useState(DEFAULT_LOOKBACK_HOURS);
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [owner, setOwner] = useState<PersonResult | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The item is found now, as far as the record is concerned: it is being
  // logged as it is picked up. The server stamps found_at itself; this is only
  // the date shown on the form.
  // What the guest will read, composed exactly as the email composes it. Staff
  // see "we found a bottle, black at Pyre" while they can still fix it, rather
  // than after it has gone to forty people.
  const emailClause = useMemo(() => {
    const clause = guestItemClause(title);
    return clause.charAt(0).toUpperCase() + clause.slice(1);
  }, [title]);

  const donateOn = useMemo(
    () => new Date(now.getTime() + DONATION_WINDOW_DAYS * 86_400_000),
    [now]
  );

  const addFiles = async (incoming: FileList | null) => {
    if (!incoming) return;
    const room = MAX_ATTACHMENTS_PER_ITEM - files.length;
    if (room <= 0) {
      setError(`That's the ${MAX_ATTACHMENTS_PER_ITEM}-photo limit`);
      return;
    }

    const accepted: PendingFile[] = [];
    for (const file of [...incoming].slice(0, room)) {
      const rejection = checkFile(file);
      if (rejection) {
        setError(rejection);
        continue;
      }
      const shrunk = await downscaleImage(file);
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: shrunk,
        previewUrl: URL.createObjectURL(shrunk),
        status: 'pending',
      });
    }
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const submit = async () => {
    if (!title.trim()) {
      setError('Say what the item is');
      return;
    }

    setSubmitting(true);
    setError(null);
    setProgress('Logging the item…');

    try {
      const res = await fetch('/api/admin/lost-found', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          storageLocation: storageLocation.trim() || null,
          leftWindowStart: leftWindow.start,
          leftWindowEnd: leftWindow.end,
          sessionIds: [...sessionIds],
          ownerMemberId: owner?.memberId || null,
          ownerName: owner?.name || null,
          ownerEmail: owner?.email || null,
        }),
      });
      if (!res.ok) {
        setError(await readError(res));
        setSubmitting(false);
        setProgress(null);
        return;
      }

      const { item } = (await res.json()) as { item: LostFoundItemRow };

      // The item exists from here on. Uploads are best-effort on top of it —
      // whatever fails can be added from the item page.
      let failed = 0;
      for (let i = 0; i < files.length; i += 1) {
        const pending = files[i];
        setProgress(`Uploading photo ${i + 1} of ${files.length}…`);
        const body = new FormData();
        body.set('itemId', item.id);
        body.set('file', pending.file);
        try {
          const upload = await fetch('/api/admin/lost-found-media', { method: 'POST', body });
          if (!upload.ok) failed += 1;
        } catch {
          failed += 1;
        }
      }

      invalidateJson('/api/admin/lost-found');
      window.location.href = `/admin/lost-found/${item.id}${failed > 0 ? '?uploads=failed' : ''}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setSubmitting(false);
      setProgress(null);
    }
  };

  const { field: ownerField } = useGuestSearch({
    selected: owner,
    // Naming an owner drops any sessions already picked: the item page would
    // otherwise open with a blast pre-selected for something we can hand back
    // to one person.
    onSelect: (person) => {
      setOwner(person);
      if (person) setSessionIds(new Set());
    },
  });

  // Sessions are only a question when nobody is named — with an owner there is
  // one person to email and no list to read. Passing an empty range skips the
  // Momence call entirely rather than fetching a list we would not show.
  const lookbackStart = useMemo(
    () => new Date(now.getTime() - lookbackHours * 3_600_000).toISOString(),
    [now, lookbackHours]
  );
  const lookbackEnd = useMemo(() => now.toISOString(), [now]);
  const { data, loading, sessions, hiddenCount } = useSessionChoices(
    owner ? '' : lookbackStart,
    owner ? '' : lookbackEnd
  );

  const toggleSession = (id: string) => {
    setSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const nextLookback = LOOKBACK_STEPS.find((h) => h > lookbackHours) ?? null;

  const pickedPeople = useMemo(() => {
    let count = 0;
    for (const session of sessions) {
      if (sessionIds.has(session.id)) count += session.attendees.length;
    }
    return count;
  }, [sessions, sessionIds]);

  // The window we store has to span every session picked, because the notify
  // route re-derives who may be emailed from the window alone and would drop
  // anything outside it. With nothing picked it falls back to the range that
  // was on screen, so the item page still has something to offer.
  const leftWindow = useMemo(() => {
    const chosen = sessions.filter((s) => sessionIds.has(s.id));
    if (chosen.length === 0) return { start: lookbackStart, end: lookbackEnd };
    const starts = chosen.map((s) => Date.parse(s.startsAt)).filter((n) => !Number.isNaN(n));
    const ends = chosen.map((s) => Date.parse(s.endsAt)).filter((n) => !Number.isNaN(n));
    if (starts.length === 0 || ends.length === 0) {
      return { start: lookbackStart, end: lookbackEnd };
    }
    return {
      start: new Date(Math.min(...starts)).toISOString(),
      end: new Date(Math.max(...ends)).toISOString(),
    };
  }, [sessions, sessionIds, lookbackStart, lookbackEnd]);

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-24">
      <a href="/admin/lost-found" className="font-mono text-xs text-white/45 hover:text-white/70">
        ← All items
      </a>

      <section>
        <SectionTitle note="Upload a clear photo of the item">Photo</SectionTitle>

        <div className="flex flex-wrap gap-3">
          {files.map((file) => (
            <div key={file.id} className="relative">
              <img
                src={file.previewUrl}
                alt=""
                className="h-24 w-24 rounded border border-white/10 object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(file.id)}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full border border-white/20 bg-black/80 text-xs text-white/70 hover:text-white"
                aria-label={`Remove ${file.file.name}`}
              >
                ×
              </button>
              <span className="mt-1 block text-center font-mono text-[10px] text-white/35">
                {formatBytes(file.file.size)}
              </span>
            </div>
          ))}

          {files.length < MAX_ATTACHMENTS_PER_ITEM && (
            <label
              className={`flex h-24 w-24 cursor-pointer items-center justify-center rounded border border-dashed border-white/20 text-center font-mono text-[10px] uppercase tracking-wide text-white/50 hover:border-white/40 ${
                submitting ? 'pointer-events-none opacity-40' : ''
              }`}
            >
              Add photo
              <input
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>What is it?</SectionTitle>

        <div className="mb-4">
          <label className={labelClass} htmlFor="lf-title">
            Item
          </label>
          <p className="mb-2 text-xs text-white/45" aria-live="polite">
            {title.trim() ? (
              <>
                The email will say: <span className="text-white/70">“{emailClause}.”</span>
              </>
            ) : (
              'Whatever you type here is the noun the guest reads in their email.'
            )}
          </p>
          <input
            id="lf-title"
            className={inputClass}
            value={title}
            maxLength={FIELD_LIMITS.title}
            placeholder="Black water bottle"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="lf-description">
            Distinguishing details — staff only
          </label>
          <textarea
            id="lf-description"
            className={`${inputClass} min-h-24`}
            value={description}
            maxLength={FIELD_LIMITS.description}
            placeholder="Dented near the base, faded REI sticker"
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="mt-1 text-xs text-white/40">
            Kept off the guest email on purpose — it's what you check against when someone comes to
            collect it.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle note="A name here means one email to one person, and nobody else gets asked.">
          Do we know whose it is?
        </SectionTitle>
        {ownerField}
      </section>

      <section>
        <SectionTitle note="So whoever is on shift can put their hand on it.">
          Where is it now?
        </SectionTitle>

        <div>
          <label className={labelClass} htmlFor="lf-storage">
            Where it's kept
          </label>
          <input
            id="lf-storage"
            className={inputClass}
            value={storageLocation}
            maxLength={FIELD_LIMITS.storageLocation}
            placeholder="Front desk bin"
            onChange={(e) => setStorageLocation(e.target.value)}
          />
        </div>
      </section>

      {!owner && (
        <section>
          <SectionTitle note="Nothing is sent from here — you send from the item page once it's logged.">
            Which sessions could it have been left in?
          </SectionTitle>

          <SessionChoices
            data={data}
            loading={loading}
            sessions={sessions}
            hiddenCount={hiddenCount}
            picked={sessionIds}
            alreadyAsked={EMPTY_ASKED}
            onToggle={toggleSession}
            emptyHint="Log it anyway — you can pick sessions on the item page."
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {nextLookback && (
              <button
                type="button"
                className={buttonClass}
                onClick={() => setLookbackHours(nextLookback)}
              >
                Look further back
              </button>
            )}
            <span className="font-mono text-xs text-white/35">
              Last {lookbackHours} hours
              {sessionIds.size > 0 &&
                ` · ${sessionIds.size} selected, ${pickedPeople} ${pickedPeople === 1 ? 'person' : 'people'}`}
            </span>
          </div>
        </section>
      )}

      <p className="text-xs text-white/40">
        Unclaimed, this goes to {DONATION_PARTNER} on{' '}
        {donateOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
      </p>

      {error && <p className="text-sm text-[var(--pyre-red)]">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Saving…' : 'Log the item'}
        </button>
        {progress && <span className="font-mono text-xs text-white/50">{progress}</span>}
      </div>
    </div>
  );
}

export default LostFoundForm;
