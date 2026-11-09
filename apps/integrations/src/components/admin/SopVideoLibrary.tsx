// The SOP video library, opened from the SOP editor's Videos button (admins
// only). Lists every walkthrough already uploaded — with a preview, its size,
// and the documents that embed it — and uploads new ones. Insert drops the
// embed markdown (`![Title](/api/admin/sop-videos/<id>)`, see lib/sops/videos)
// into the document at the caret; the editor owns where that is.
//
// Uploads go straight from the browser to storage on a signed URL the route
// hands out (POST start), with a progress bar, then the route confirms the
// file landed (POST complete). See /api/admin/sop-videos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, modalPanelClass } from '@/components/admin/Modal';
import { buttonClass, compactInputClass, goldButtonClass } from '@/components/admin/ui';
import { formatBytes } from '@/lib/media/attachments';
import {
  checkSopVideoFile,
  normalizeMime,
  SOP_VIDEO_ACCEPT,
  SOP_VIDEO_ROUTE,
  type SopVideo,
  sopVideoMarkdown,
  sopVideoSrc,
  titleFromFileName,
} from '@/lib/sops/videos';

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

export function SopVideoLibrary({
  onInsert,
  onClose,
}: {
  /** Insert this markdown into the document. */
  onInsert: (markdown: string) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<SopVideo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [filter, setFilter] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(SOP_VIDEO_ROUTE);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as { videos: SopVideo[] };
      setVideos(body.videos);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the videos');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uploading = upload !== null && upload.error === null;

  async function startUpload(file: File) {
    const problem = checkSopVideoFile(file);
    if (problem) {
      setUpload({ fileName: file.name, progress: 0, error: problem });
      return;
    }
    setUpload({ fileName: file.name, progress: 0, error: null });
    try {
      const start = await fetch(SOP_VIDEO_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          fileName: file.name,
          mimeType: normalizeMime(file.type),
          sizeBytes: file.size,
          title: titleFromFileName(file.name),
        }),
      });
      if (!start.ok) throw new Error(await readError(start));
      const { id, uploadUrl } = (await start.json()) as { id: string; uploadUrl: string };

      await putToStorage(uploadUrl, file, (progress) =>
        setUpload((u) => (u ? { ...u, progress } : u))
      );

      const done = await fetch(SOP_VIDEO_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', id }),
      });
      if (!done.ok) throw new Error(await readError(done));
      const { video } = (await done.json()) as { video: SopVideo };

      setVideos((list) => [video, ...(list ?? []).filter((v) => v.id !== video.id)]);
      setUpload(null);
      // A fresh upload almost always gets a better name than its file had.
      setEditing({ id: video.id, title: video.title });
    } catch (err) {
      setUpload((u) => ({
        fileName: u?.fileName ?? file.name,
        progress: 0,
        error: err instanceof Error ? err.message : 'Upload failed',
      }));
    }
  }

  async function rename(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`${SOP_VIDEO_ROUTE}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { video } = (await res.json()) as { video: SopVideo };
      setVideos((list) => (list ?? []).map((v) => (v.id === id ? video : v)));
      setEditing(null);
    } catch (err) {
      setRowError({ id, message: err instanceof Error ? err.message : 'Rename failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(video: SopVideo) {
    const usedNote =
      video.used_in.length > 0
        ? `\n\nIt is still embedded in: ${video.used_in.map((s) => s.title).join(', ')}. Those players will stop working.`
        : '';
    if (!window.confirm(`Delete “${video.title}” from the library?${usedNote}`)) return;
    setBusyId(video.id);
    setRowError(null);
    try {
      const force = video.used_in.length > 0 ? '?force=1' : '';
      const res = await fetch(`${SOP_VIDEO_ROUTE}/${video.id}${force}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setVideos((list) => (list ?? []).filter((v) => v.id !== video.id));
    } catch (err) {
      setRowError({ id: video.id, message: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setBusyId(null);
    }
  }

  const term = filter.trim().toLowerCase();
  const shown = (videos ?? []).filter(
    (v) => !term || v.title.toLowerCase().includes(term) || v.file_name.toLowerCase().includes(term)
  );

  return (
    <Modal
      labelledBy="sop-video-library-title"
      onClose={onClose}
      initialFocus={closeRef}
      // Don't lose a running upload to a stray Escape.
      closeOnEscape={() => !uploading && editing === null}
      panelClassName={`${modalPanelClass} flex max-h-[90vh] max-w-2xl flex-col`}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <h2
          id="sop-video-library-title"
          className="text-base font-semibold text-[var(--pyre-creme)]"
        >
          Video library
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
            Upload video
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SOP_VIDEO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void startUpload(file);
            }}
          />
          <input
            type="search"
            className={`${compactInputClass} min-w-40 flex-1`}
            placeholder="Filter videos"
            aria-label="Filter videos"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <p className="font-mono text-[10px] text-white/40">
          MP4, WebM or MOV, up to 500 MB. Stored in Pyre’s own storage — nothing is shared publicly.
          Insert adds the video at the cursor; add #t=1:30 to the link to start partway through.
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
        ) : videos === null ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-white/50">
            {videos.length === 0
              ? 'No videos yet. Upload a walkthrough to embed it in this SOP.'
              : 'No videos match.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((video) => (
              <li key={video.id} className="rounded border border-white/10 bg-white/5 p-3">
                {editing?.id === video.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename(video.id, editing.title);
                    }}
                  >
                    <input
                      className={`${compactInputClass} min-w-48 flex-1`}
                      aria-label="Video title"
                      value={editing.title}
                      maxLength={200}
                      disabled={busyId === video.id}
                      onChange={(e) => setEditing({ id: video.id, title: e.target.value })}
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
                      disabled={busyId === video.id || !editing.title.trim()}
                    >
                      Save
                    </button>
                    <button type="button" className={buttonClass} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--pyre-creme)]">{video.title}</p>
                      <p className="truncate font-mono text-[10px] text-white/40">
                        {formatBytes(video.size_bytes)} · {video.file_name} ·{' '}
                        {new Date(video.created_at).toLocaleDateString()}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/50">
                        {video.used_in.length === 0
                          ? 'Not used in any SOP yet'
                          : `Used in ${video.used_in.map((s) => s.title).join(', ')}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={goldButtonClass}
                        onClick={() => onInsert(sopVideoMarkdown(video))}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-expanded={previewId === video.id}
                        onClick={() => setPreviewId((id) => (id === video.id ? null : video.id))}
                      >
                        {previewId === video.id ? 'Hide' : 'Preview'}
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setEditing({ id: video.id, title: video.title })}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busyId === video.id}
                        onClick={() => void remove(video)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                {rowError?.id === video.id && (
                  <p role="alert" className="mt-2 text-xs text-red-300">
                    {rowError.message}
                  </p>
                )}
                {previewId === video.id && (
                  // biome-ignore lint/a11y/useMediaCaption: staff walkthroughs carry no caption track
                  <video
                    src={sopVideoSrc(video.id)}
                    controls
                    playsInline
                    preload="metadata"
                    className="mt-3 block aspect-video w-full rounded bg-black"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
