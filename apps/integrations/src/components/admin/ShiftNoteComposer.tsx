// The shift-note composer: pick the shift date, write what the next crew or
// the admins should know, attach photos or video backing what you saw. Used
// in two places — the top of /admin/shift-notes and the quick-add modal the
// header's plus button opens (QuickShiftNote) — so both write notes the same
// way. Media uploads eagerly: each file starts uploading the moment it is
// picked (a staged attachment with no note yet, per-chip progress), and
// creating the note claims the finished uploads by id — so submitting never
// waits on file transfer that could have already happened.
//
// A created note is announced on the document (SHIFT_NOTE_CREATED_EVENT), so
// the log on /admin/shift-notes picks up a note written from the header modal
// without a reload, the same way it picks up one written inline.
import { type Ref, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ShiftNoteAttachmentRow, ShiftNoteRow } from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  MAX_ATTACHMENTS_PER_NOTE,
} from '@/lib/shift-notes/media';
import { NOTE_BODY_MAX, todayEastern } from '@/lib/shift-notes/validate';
import type { PeopleNames } from '@/lib/sops/names';

export const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export const primaryButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

export const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

export const textareaClass = `${inputClass} min-h-[100px] w-full`;

/** What POST /api/admin/shift-notes hands back for a new note. */
export interface CreatedShiftNote {
  note: ShiftNoteRow;
  attachments: ShiftNoteAttachmentRow[];
  people: PeopleNames;
}

/** Fired on `document` with a CreatedShiftNote detail after every new note. */
export const SHIFT_NOTE_CREATED_EVENT = 'pyre:shift-note-created';

export async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** One composer file and where its eager upload stands. */
interface StagedFile {
  /** fileKey of the original pick — dedupe identity and React key. */
  key: string;
  /** The original file, kept for retry (downscaling runs again). */
  file: File;
  status: 'uploading' | 'uploaded' | 'failed';
  /** 0–100 while uploading. */
  progress: number;
  /** The staged attachment row, once the upload lands. */
  attachment: ShiftNoteAttachmentRow | null;
  error?: string;
}

/**
 * POST one multipart form via XHR — fetch can't report upload progress, and a
 * 50 MB video over venue wifi needs a moving number, not a frozen spinner.
 * Cookies ride along same-origin by default, so the route's auth and
 * same-origin checks behave exactly as with fetch.
 */
export function uploadWithProgress(
  form: FormData,
  onProgress: (pct: number) => void
): { promise: Promise<ShiftNoteAttachmentRow>; xhr: XMLHttpRequest } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<ShiftNoteAttachmentRow>((resolve, reject) => {
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let parsed: { attachment?: ShiftNoteAttachmentRow; error?: string } = {};
      try {
        parsed = JSON.parse(xhr.responseText) as typeof parsed;
      } catch {
        // Non-JSON body; the status check below carries the error.
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.attachment) resolve(parsed.attachment);
      else reject(new Error(parsed.error ?? `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check the connection'));
    xhr.onabort = () => reject(new Error('Upload canceled'));
    xhr.open('POST', '/api/admin/shift-note-media');
    xhr.send(form);
  });
  return { promise, xhr };
}

/** "Thursday, Aug 21" (+ year when it isn't this year). */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const thisYear = new Date().getFullYear() === year;
  return utc.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(thisYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** Stable identity for a staged file, so picking the same one twice is a no-op. */
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** The "Note added…" line, including any files that didn't make it. */
export function createdNotice(created: CreatedShiftNote, sent: number): string {
  const attached = created.attachments.length;
  // Fewer claimed than sent only happens in a rare race (a stale staged
  // upload swept mid-submit); the note itself is safe either way.
  const shortfall = sent - attached;
  return (
    `Note added for ${formatDay(created.note.note_date)}.` +
    (attached > 0 ? ` ${attached} file${attached === 1 ? '' : 's'} attached.` : '') +
    (shortfall > 0
      ? ` ${shortfall} file${shortfall === 1 ? '' : 's'} could not be attached — please add ${shortfall === 1 ? 'it' : 'them'} again on the note.`
      : '')
  );
}

export function ShiftNoteComposer({
  onCreated,
  onUploadingChange,
  textareaRef,
  heading = 'Add a shift note',
  headingId,
}: {
  /** After a note lands; `notice` is the summary line to show the writer. */
  onCreated?: (created: CreatedShiftNote, notice: string) => void;
  /** Whether a file is mid-transfer, for a host that needs to know. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Lets a host focus the note field (the modal does on open). */
  textareaRef?: Ref<HTMLTextAreaElement>;
  heading?: string;
  /** id for the heading, so a dialog can point aria-labelledby at it. */
  headingId?: string;
}) {
  const fallbackId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState(todayEastern);
  const [draftBody, setDraftBody] = useState('');
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [waitingUploads, setWaitingUploads] = useState(false);

  // Mirror of `staged` that updates synchronously, so code that just awaited
  // something (submit, upload settle) reads current chips, not a stale render.
  const stagedRef = useRef<StagedFile[]>([]);
  const updateStaged = useCallback((updater: (prev: StagedFile[]) => StagedFile[]) => {
    stagedRef.current = updater(stagedRef.current);
    setStaged(stagedRef.current);
  }, []);

  // In-flight uploads: promises for submit to await, XHRs so a removed chip
  // can abort its transfer.
  const uploadPromises = useRef(new Map<string, Promise<void>>());
  const uploadXhrs = useRef(new Map<string, XMLHttpRequest>());

  /**
   * Upload one staged chip (fresh pick or retry): downscale, POST without a
   * noteId — the server stages the file until the note exists to claim it —
   * and move the chip through uploading → uploaded/failed as it goes.
   */
  const startUpload = (key: string, original: File) => {
    updateStaged((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, status: 'uploading', progress: 0, error: undefined } : s
      )
    );
    const task = (async () => {
      try {
        const file = await downscaleImage(original);
        const form = new FormData();
        form.set('file', file);
        const { promise, xhr } = uploadWithProgress(form, (pct) =>
          updateStaged((prev) => prev.map((s) => (s.key === key ? { ...s, progress: pct } : s)))
        );
        uploadXhrs.current.set(key, xhr);
        const attachment = await promise;
        updateStaged((prev) =>
          prev.map((s) =>
            s.key === key ? { ...s, status: 'uploaded', progress: 100, attachment } : s
          )
        );
      } catch (e) {
        // A chip removed mid-flight is already gone from the list — the map
        // finds nothing and this is a no-op.
        updateStaged((prev) =>
          prev.map((s) =>
            s.key === key
              ? { ...s, status: 'failed', error: e instanceof Error ? e.message : 'Upload failed' }
              : s
          )
        );
      } finally {
        uploadXhrs.current.delete(key);
        uploadPromises.current.delete(key);
      }
    })();
    uploadPromises.current.set(key, task);
  };

  /** Stage files, rejecting bad ones immediately; uploads start now. */
  const stageFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const good: File[] = [];
    for (const file of Array.from(list)) {
      const problem = checkFile(file);
      if (problem) setError(problem);
      else good.push(file);
    }
    const seen = new Set(stagedRef.current.map((s) => s.key));
    const fresh = good.filter((file) => !seen.has(fileKey(file)));
    const room = Math.max(0, MAX_ATTACHMENTS_PER_NOTE - stagedRef.current.length);
    if (fresh.length > room) {
      setError(`A note can hold ${MAX_ATTACHMENTS_PER_NOTE} attachments at most`);
    }
    const taken = fresh.slice(0, room);
    if (taken.length === 0) return;
    updateStaged((prev) => [
      ...prev,
      ...taken.map((file) => ({
        key: fileKey(file),
        file,
        status: 'uploading' as const,
        progress: 0,
        attachment: null,
      })),
    ]);
    for (const file of taken) startUpload(fileKey(file), file);
  };

  /** Drop a chip: cancel its transfer, or delete the already-staged upload. */
  const removeStaged = (entry: StagedFile) => {
    uploadXhrs.current.get(entry.key)?.abort();
    if (entry.attachment) {
      // Best-effort — a missed delete is an unclaimed row the daily sweep collects.
      void fetch(`/api/admin/shift-note-media?id=${encodeURIComponent(entry.attachment.id)}`, {
        method: 'DELETE',
      });
    }
    updateStaged((prev) => prev.filter((s) => s.key !== entry.key));
  };

  const addNote = async () => {
    setBusy(true);
    setError(null);
    try {
      // Uploads have been running since the files were picked; usually they
      // are already done and this await is instant.
      if (uploadPromises.current.size > 0) {
        setWaitingUploads(true);
        await Promise.allSettled([...uploadPromises.current.values()]);
        setWaitingUploads(false);
      }
      if (stagedRef.current.some((s) => s.status === 'failed')) {
        setError('Some files failed to upload — retry or remove them, then add the note.');
        return;
      }
      const attachmentIds = stagedRef.current
        .map((s) => s.attachment?.id)
        .filter((id): id is string => !!id);
      const res = await fetch('/api/admin/shift-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteDate: draftDate, body: draftBody, attachmentIds }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const created = (await res.json()) as CreatedShiftNote;
      setDraftBody('');
      updateStaged(() => []);
      document.dispatchEvent(
        new CustomEvent<CreatedShiftNote>(SHIFT_NOTE_CREATED_EVENT, { detail: created })
      );
      onCreated?.(created, createdNotice(created, attachmentIds.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the note');
    } finally {
      setBusy(false);
      setWaitingUploads(false);
    }
  };

  // Leaving the page mid-transfer kills the upload; warn only then. Files
  // that finished uploading are safe to abandon — the server sweeps unclaimed
  // ones — so no nagging once transfers settle.
  const uploading = staged.some((s) => s.status === 'uploading');
  useEffect(() => {
    onUploadingChange?.(uploading);
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploading, onUploadingChange]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id={headingId ?? fallbackId}
          className="font-mono text-xs uppercase tracking-wide text-white/60"
        >
          {heading}
        </h2>
        <label className="flex items-center gap-2 font-mono text-xs text-white/60">
          shift date
          <input
            type="date"
            className={inputClass}
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
          />
        </label>
      </div>
      <textarea
        ref={textareaRef}
        className={textareaClass}
        placeholder="Slow start, packed from 7 on. Tub 2 heater kept short-cycling — logged it in Water. Maya handled a tough guest situation really well."
        maxLength={NOTE_BODY_MAX}
        value={draftBody}
        onChange={(e) => setDraftBody(e.target.value)}
        aria-label="Shift note"
      />
      {staged.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {staged.map((entry) => (
            <li
              key={entry.key}
              aria-busy={entry.status === 'uploading'}
              className={`flex items-center gap-2 rounded border px-2 py-1 font-mono text-[10px] ${
                entry.status === 'failed'
                  ? 'border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 text-[var(--pyre-red)]'
                  : 'border-white/10 bg-white/5 text-white/60'
              }`}
            >
              <span className="max-w-40 truncate" title={entry.file.name}>
                {entry.file.name}
              </span>
              <span className="text-white/30">{formatBytes(entry.file.size)}</span>
              {entry.status === 'uploading' && (
                <span className="text-white/40">uploading {entry.progress}%</span>
              )}
              {entry.status === 'uploaded' && (
                <span className="text-[var(--pyre-sage)]">uploaded</span>
              )}
              {entry.status === 'failed' && (
                <>
                  <span title={entry.error}>failed</span>
                  <button
                    type="button"
                    className="uppercase underline hover:text-white"
                    onClick={() => startUpload(entry.key, entry.file)}
                  >
                    Retry
                  </button>
                </>
              )}
              <button
                type="button"
                className="text-white/40 hover:text-[var(--pyre-red)]"
                aria-label={`Remove ${entry.file.name}`}
                onClick={() => removeStaged(entry)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy || !draftBody.trim() || !draftDate}
          onClick={() => void addNote()}
        >
          {waitingUploads ? 'Waiting for uploads…' : 'Add note'}
        </button>
        <label className={`${buttonClass} cursor-pointer`}>
          Take a photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={staged.length >= MAX_ATTACHMENTS_PER_NOTE}
            onChange={(e) => {
              stageFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className={`${buttonClass} cursor-pointer`}>
          Add photos / video
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            multiple
            className="hidden"
            disabled={staged.length >= MAX_ATTACHMENTS_PER_NOTE}
            onChange={(e) => {
              stageFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
