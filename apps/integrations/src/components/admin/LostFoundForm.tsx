// Logging something a guest left behind.
//
// The photo comes first and does most of the work. A staff member closing up
// has a bottle in one hand and a phone in the other; "take a picture, say what
// it is" is the whole interaction, and everything below the fold has a
// sensible default. The picture is also what a guest recognises in an email —
// no wording beats seeing your own jacket.
//
// The left-in window defaults to the hours before it was found and is only
// worth touching when staff know better ("this was on the bench at open, so it
// was here overnight"). It is what decides which sessions we can offer to
// email, so it is visible rather than hidden.

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
  AREA_LABELS,
  CATEGORY_OPTIONS,
  DEFAULT_LOOKBACK_HOURS,
  DONATION_PARTNER,
  DONATION_WINDOW_DAYS,
  LOST_FOUND_AREAS,
} from '@/lib/lost-found/types';
import { FIELD_LIMITS } from '@/lib/lost-found/validate';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  readError,
  SectionTitle,
  TileButton,
} from './incidentUi';
import { type PersonResult, useGuestSearch } from './GuestSearch';

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
}

/** `datetime-local` wants a local-clock string, not an ISO instant. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function LostFoundForm() {
  const now = useMemo(() => new Date(), []);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('bottle');
  const [description, setDescription] = useState('');
  const [area, setArea] = useState('changing_area');
  const [storageLocation, setStorageLocation] = useState('');
  const [foundAt, setFoundAt] = useState(() => toLocalInput(now));
  const [windowStart, setWindowStart] = useState(() =>
    toLocalInput(new Date(now.getTime() - DEFAULT_LOOKBACK_HOURS * 3_600_000))
  );
  const [showWindow, setShowWindow] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [owner, setOwner] = useState<PersonResult | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const donateOn = useMemo(() => {
    const ms = Date.parse(foundAt);
    if (Number.isNaN(ms)) return null;
    return new Date(ms + DONATION_WINDOW_DAYS * 86_400_000);
  }, [foundAt]);

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
          category,
          description: description.trim() || null,
          area,
          storageLocation: storageLocation.trim() || null,
          foundAt: fromLocalInput(foundAt),
          leftWindowStart: fromLocalInput(windowStart),
          leftWindowEnd: fromLocalInput(foundAt),
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

  const { field: ownerField } = useGuestSearch({ selected: owner, onSelect: setOwner });

  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-24">
      <section>
        <SectionTitle note="The fastest way to describe a thing — and what its owner will recognise.">
          Photo
        </SectionTitle>

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
          <input
            id="lf-title"
            className={inputClass}
            value={title}
            maxLength={FIELD_LIMITS.title}
            placeholder="Black water bottle"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CATEGORY_OPTIONS.map((option) => (
            <TileButton
              key={option.value}
              selected={category === option.value}
              label={option.label}
              onClick={() => setCategory(option.value)}
            />
          ))}
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
        <SectionTitle>Where and when</SectionTitle>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOST_FOUND_AREAS.map((value) => (
            <TileButton
              key={value}
              selected={area === value}
              label={AREA_LABELS[value]}
              onClick={() => setArea(value)}
            />
          ))}
        </div>

        <div className="mb-4">
          <label className={labelClass} htmlFor="lf-found-at">
            Found at
          </label>
          <input
            id="lf-found-at"
            type="datetime-local"
            className={inputClass}
            value={foundAt}
            onChange={(e) => setFoundAt(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className={labelClass} htmlFor="lf-storage">
            Where it is now
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

        {showWindow ? (
          <div>
            <label className={labelClass} htmlFor="lf-window-start">
              Could have been left any time after
            </label>
            <input
              id="lf-window-start"
              type="datetime-local"
              className={inputClass}
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
            <p className="mt-1 text-xs text-white/40">
              Decides which sessions we can offer to email. Widen it if this could have been sitting
              there a while.
            </p>
          </div>
        ) : (
          <button type="button" className={buttonClass} onClick={() => setShowWindow(true)}>
            Sitting there a while?
          </button>
        )}
      </section>

      <section>
        <SectionTitle note="If you already know whose it is, we can email just them.">
          Do we know whose it is?
        </SectionTitle>
        {ownerField}
      </section>

      {donateOn && (
        <p className="text-xs text-white/40">
          Unclaimed, this goes to {DONATION_PARTNER} on{' '}
          {donateOn.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
        </p>
      )}

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
