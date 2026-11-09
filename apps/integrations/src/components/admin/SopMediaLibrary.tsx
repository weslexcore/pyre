// The SOP media library, opened from the SOP editor's Media button (admins
// only). Lists every image and video walkthrough already uploaded, with a
// preview, its size, and the documents that embed it, and uploads new ones.
// Insert drops the embed markdown (`![Title](/api/admin/sop-images/<id>)` or
// `…/sop-videos/<id>`, see lib/sops/media) into the document at the caret;
// the editor owns where that is.
//
// Uploads go straight from the browser to storage on a signed URL the route
// hands out (POST start), with a progress bar, then the route confirms the
// file landed (POST complete). See /api/admin/sop-media. Large phone photos
// are shrunk first (downscaleImage), the same as every other photo upload in
// the dashboard. Screenshots (PNG) are left alone so their text stays sharp.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, modalPanelClass } from '@/components/admin/Modal';
import { buttonClass, compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { downscaleImage, formatBytes } from '@/lib/media/attachments';
import {
  checkSopMediaFile,
  normalizeMime,
  SOP_MEDIA_ACCEPT,
  SOP_MEDIA_ROUTE,
  type SopMedia,
  type SopMediaKind,
  sopMediaMarkdown,
  sopMediaSrc,
  titleFromFileName,
} from '@/lib/sops/media';

type Filter = 'all' | SopMediaKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
];

interface Upload {
  fileName: string;
  /** 0–1 */
  progress: number;
  error: string | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Send the file to storage's signed upload URL the way supabase-js's
 * uploadToSignedUrl does (multipart, the file under an empty field name),
 * over XHR so progress can be shown.
 */
function putToStorage(url: string, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      let message = `Upload failed (HTTP ${xhr.status})`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        message = parsed.message ?? parsed.error ?? message;
      } catch {
        // Not JSON; keep the status line.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check the connection and try again'));
    xhr.send(body);
  });
}

/** Phone photos get shrunk before upload; screenshots and GIFs go as they are. */
async function prepare(file: File): Promise<File> {
  const mime = normalizeMime(file.type);
  if (mime === 'image/jpeg' || mime === 'image/webp') return downscaleImage(file);
  return file;
}

export function SopMediaLibrary({
  onInsert,
  onClose,
}: {
  /** Insert this markdown into the document. */
  onInsert: (markdown: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<SopMedia[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [kindFilter, setKindFilter] = useState<Filter>('all');
  const [filter, setFilter] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(SOP_MEDIA_ROUTE);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { media: SopMedia[] };
      setMedia(body.media);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the library');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uploading = upload !== null && upload.error === null;

  async function startUpload(picked: File) {
    const problem = checkSopMediaFile(picked);
    if (problem) {
      setUpload({ fileName: picked.name, progress: 0, error: problem });
      return;
    }
    setUpload({ fileName: picked.name, progress: 0, error: null });
    try {
      const file = await prepare(picked);
      const start = await fetch(SOP_MEDIA_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          fileName: file.name,
          mimeType: normalizeMime(file.type),
          sizeBytes: file.size,
          title: titleFromFileName(picked.name),
        }),
      });
      if (!start.ok) throw new Error(await readError(start));
      const { id, uploadUrl } = (await start.json()) as { id: string; uploadUrl: string };

      await putToStorage(uploadUrl, file, (progress) =>
        setUpload((u) => (u ? { ...u, progress } : u))
      );

      const done = await fetch(SOP_MEDIA_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', id }),
      });
      if (!done.ok) throw new Error(await readError(done));
      const { media: added } = (await done.json()) as { media: SopMedia };

      setMedia((list) => [added, ...(list ?? []).filter((m) => m.id !== added.id)]);
      setUpload(null);
      // Make sure the new file is visible, and prompt for a better name than
      // the file had: it becomes the alt text and the video caption.
      if (kindFilter !== 'all' && kindFilter !== added.kind) setKindFilter('all');
      setEditing({ id: added.id, title: added.title });
    } catch (err) {
      setUpload((u) => ({
        fileName: u?.fileName ?? picked.name,
        progress: 0,
        error: err instanceof Error ? err.message : 'Upload failed',
      }));
    }
  }

  async function rename(item: SopMedia, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusyId(item.id);
    setRowError(null);
    try {
      const res = await fetch(sopMediaSrc(item), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { media: renamed } = (await res.json()) as { media: SopMedia };
      setMedia((list) => (list ?? []).map((m) => (m.id === item.id ? renamed : m)));
      setEditing(null);
    } catch (err) {
      setRowError({ id: item.id, message: err instanceof Error ? err.message : 'Rename failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: SopMedia) {
    const noun = item.kind === 'image' ? 'image' : 'video';
    const usedNote =
      item.used_in.length > 0
        ? `\n\nIt is still embedded in: ${item.used_in.map((s) => s.title).join(', ')}. The ${noun} will disappear from those SOPs.`
        : '';
    if (!window.confirm(`Delete “${item.title}” from the library?${usedNote}`)) return;
    setBusyId(item.id);
    setRowError(null);
    try {
      const force = item.used_in.length > 0 ? '?force=1' : '';
      const res = await fetch(`${sopMediaSrc(item)}${force}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setMedia((list) => (list ?? []).filter((m) => m.id !== item.id));
    } catch (err) {
      setRowError({ id: item.id, message: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setBusyId(null);
    }
  }

  const term = filter.trim().toLowerCase();
  const shown = (media ?? []).filter(
    (m) =>
      (kindFilter === 'all' || m.kind === kindFilter) &&
      (!term || m.title.toLowerCase().includes(term) || m.file_name.toLowerCase().includes(term))
  );

  return (
    <Modal
      labelledBy="sop-media-library-title"
      onClose={onClose}
      initialFocus={closeRef}
      // Don't lose a running upload to a stray Escape.
      closeOnEscape={() => !uploading && editing === null}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-2xl flex-col`}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <h2
          id="sop-media-library-title"
          className="text-base font-semibold text-[var(--pyre-creme)]"
        >
          Media library
        </h2>
        <button
          ref={closeRef}
          type="button"
          className={`${buttonClass} ml-auto`}
          onClick={onClose}
          disabled={uploading}
        >
          Close
        </button>
      </div>

      <div className="space-y-3 border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={goldButtonClass}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            Upload image or video
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SOP_MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void startUpload(file);
            }}
          />
          <fieldset className="flex gap-1">
            <legend className="sr-only">Show</legend>
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kindFilter === option.value}
                className={`${buttonClass} ${kindFilter === option.value ? 'border-white/40 text-white' : ''}`}
                onClick={() => setKindFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <input
            type="search"
            className={`${compactInputClass} min-w-40 flex-1`}
            placeholder="Filter by name"
            aria-label="Filter by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <p className="font-mono text-[10px] text-white/40">
          Images: JPEG, PNG, WebP or GIF, up to 20 MB. Videos: MP4, WebM or MOV, up to 500 MB.
          Stored in Pyre’s own storage — nothing is shared publicly. Insert adds it at the cursor;
          add #t=1:30 to a video link to start partway through.
        </p>
        {upload && (
          <div className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="truncate text-white/80">{upload.fileName}</span>
              {upload.error ? (
                <button
                  type="button"
                  className="ml-auto text-white/50 hover:text-white"
                  onClick={() => setUpload(null)}
                >
                  Dismiss
                </button>
              ) : (
                <span className="ml-auto font-mono text-white/50">
                  {upload.progress >= 1 ? 'Finishing…' : `${Math.round(upload.progress * 100)}%`}
                </span>
              )}
            </div>
            {upload.error ? (
              <p role="alert" className="mt-1 text-red-300">
                {upload.error}
              </p>
            ) : (
              <div
                className="mt-2 h-1 overflow-hidden rounded bg-white/10"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(upload.progress * 100)}
              >
                <div
                  className="h-full bg-[var(--pyre-gold)] transition-[width]"
                  style={{ width: `${Math.round(upload.progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loadError ? (
          <div className="flex items-center gap-2 text-sm text-red-300">
            <span role="alert">{loadError}</span>
            <button type="button" className={buttonClass} onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : media === null ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-white/50">
            {media.length === 0
              ? 'Nothing here yet. Upload a photo or a walkthrough to embed it in this SOP.'
              : 'Nothing matches.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((item) => (
              <li key={item.id} className="rounded border border-white/10 bg-white/5 p-3">
                {editing?.id === item.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename(item, editing.title);
                    }}
                  >
                    <input
                      className={`${compactInputClass} min-w-48 flex-1`}
                      aria-label={item.kind === 'image' ? 'Image description' : 'Video title'}
                      placeholder={
                        item.kind === 'image' ? 'What the image shows' : 'What the video shows'
                      }
                      value={editing.title}
                      maxLength={200}
                      disabled={busyId === item.id}
                      onChange={(e) => setEditing({ id: item.id, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className={goldButtonClass}
                      disabled={busyId === item.id || !editing.title.trim()}
                    >
                      Save
                    </button>
                    <button type="button" className={buttonClass} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    {item.kind === 'image' && (
                      <img
                        src={sopMediaSrc(item)}
                        alt=""
                        loading="lazy"
                        className="h-14 w-20 shrink-0 rounded border border-white/10 bg-black object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--pyre-creme)]">
                        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
                          {item.kind}
                        </span>
                        {item.title}
                      </p>
                      <p className="truncate font-mono text-[10px] text-white/40">
                        {formatBytes(item.size_bytes)} · {item.file_name} ·{' '}
                        {new Date(item.created_at).toLocaleDateString()}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/50">
                        {item.used_in.length === 0
                          ? 'Not used in any SOP yet'
                          : `Used in ${item.used_in.map((s) => s.title).join(', ')}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={goldButtonClass}
                        onClick={() => onInsert(sopMediaMarkdown(item))}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-expanded={previewId === item.id}
                        onClick={() => setPreviewId((id) => (id === item.id ? null : item.id))}
                      >
                        {previewId === item.id ? 'Hide' : 'Preview'}
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setEditing({ id: item.id, title: item.title })}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busyId === item.id}
                        onClick={() => void remove(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                {rowError?.id === item.id && (
                  <p role="alert" className="mt-2 text-xs text-red-300">
                    {rowError.message}
                  </p>
                )}
                {previewId === item.id &&
                  (item.kind === 'image' ? (
                    <img
                      src={sopMediaSrc(item)}
                      alt={item.title}
                      className="mt-3 block max-h-[50vh] max-w-full rounded border border-white/10"
                    />
                  ) : (
                    // biome-ignore lint/a11y/useMediaCaption: staff walkthroughs carry no caption track
                    <video
                      src={sopMediaSrc(item)}
                      controls
                      playsInline
                      preload="metadata"
                      className="mt-3 block aspect-video w-full rounded bg-black"
                    />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
