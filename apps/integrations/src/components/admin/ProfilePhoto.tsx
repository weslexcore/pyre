// /admin/account: the signed-in person's own avatar. They can upload a
// photo, which the browser crops to a centred square and shrinks before it
// is sent, or keep the initials badge and choose its colour. Writes go to
// /api/admin/staff-avatar, which only touches the caller's own staff row.
// The page's staff directory is patched as soon as a write lands, so the
// nav badge and every other badge for them update without a reload.

import { type ChangeEvent, useRef, useState } from 'react';
import { readError, sendJson } from '@/lib/client/api';
import { patchStaffEntry, useStaffEntry } from '@/lib/client/staffDirectory';
import { AVATAR_COLOR_KEYS, AVATAR_COLORS, type AvatarColor } from '@/lib/staff/avatar';
import { ErrorBanner } from './ErrorBanner';
import { StaffAvatar } from './StaffAvatar';

/** Stored avatars are this many pixels square: sharp at 2x for the largest badge. */
const OUTPUT_PX = 256;

const CARD = 'rounded-lg border border-white/10 bg-white/[0.03] p-4';
const PRIMARY =
  'rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:border-[var(--pyre-red)] disabled:opacity-40';
const QUIET =
  'font-mono text-xs uppercase tracking-wide text-white/50 underline hover:text-white disabled:opacity-40';

/** The picked image, centre-cropped to a square and re-encoded as a small JPEG. */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('That file could not be read as an image');
    }
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('That image is empty');
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot resize images');
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      OUTPUT_PX,
      OUTPUT_PX
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88)
    );
    if (!blob) throw new Error('Could not process that image');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfilePhoto({ email, name }: { email: string; name: string }) {
  const entry = useStaffEntry(email);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No directory entry = no staff row (an env-allowlisted admin): nothing to save to.
  if (!entry) {
    return (
      <section className={CARD}>
        <h2 className="text-base font-semibold">Profile photo</h2>
        <p className="mt-1 text-xs text-white/50">
          Your email is not on the staff roster, so there is no profile to add a photo to.
        </p>
      </section>
    );
  }

  const selected = AVATAR_COLOR_KEYS.find((key) => AVATAR_COLORS[key] === entry.color);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', await squareJpeg(file), 'avatar.jpg');
      const res = await fetch('/api/admin/staff-avatar', { method: 'POST', body: form });
      if (!res.ok) throw new Error(await readError(res));
      const { src } = (await res.json()) as { src: string };
      patchStaffEntry(email, { src });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/admin/staff-avatar', 'DELETE');
      patchStaffEntry(email, { src: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickColor(color: AvatarColor) {
    if (color === selected) return;
    const previous = entry?.color;
    patchStaffEntry(email, { color: AVATAR_COLORS[color] });
    setError(null);
    try {
      await sendJson('/api/admin/staff-avatar', 'PATCH', { color });
    } catch (e) {
      if (previous) patchStaffEntry(email, { color: previous });
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className={CARD}>
      <h2 className="text-base font-semibold">Profile photo</h2>
      <p className="text-xs text-white/50">
        Shown beside your name across the dashboard. Without a photo you get your initial.
      </p>

      <div className="mt-4 flex items-center gap-4">
        <StaffAvatar email={email} name={name} size="xl" />
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className={PRIMARY}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? 'Saving…' : entry.src ? 'Change photo' : 'Upload photo'}
            </button>
            {entry.src && (
              <button type="button" className={QUIET} disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
          </div>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={upload} />
          {!entry.src && (
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                Badge colour
              </legend>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLOR_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={key === selected}
                    onClick={() => pickColor(key)}
                    style={{ backgroundColor: AVATAR_COLORS[key] }}
                    className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                      key === selected
                        ? 'ring-2 ring-[var(--pyre-creme)] ring-offset-2 ring-offset-[var(--pyre-black)]'
                        : ''
                    }`}
                  />
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </div>

      {error && (
        <ErrorBanner mono className="mt-3">
          {error}
        </ErrorBanner>
      )}
    </section>
  );
}
