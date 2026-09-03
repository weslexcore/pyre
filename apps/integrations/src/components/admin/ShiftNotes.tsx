// Shift notes (/admin/shift-notes). A composer on top — pick the shift date,
// write what the next crew or the admins should know, attach photos or video
// backing what you saw — and the log below, grouped by shift date, newest
// first. Everyone on the roster writes notes; what the log holds depends on
// who is reading it — an admin gets everyone's, everyone else only their own
// — so a non-admin's view is entirely theirs to edit and needs no person
// filter. The server decides all of that (the island only renders what came
// back, and every mutation is re-checked). Media uploads eagerly: each file
// starts uploading the moment it is picked (a staged attachment with no note
// yet, per-chip progress), and creating the note claims the finished uploads
// by id — so submitting never waits on file transfer that could have already
// happened. Media can also be added to or removed from an existing note.
// Clicking a photo or video opens it in the ShiftNoteViewer lightbox, which
// steps through that note's media without leaving the page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShiftNoteAttachmentRow, ShiftNoteRow } from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  MAX_ATTACHMENTS_PER_NOTE,
} from '@/lib/shift-notes/media';
import { NOTE_BODY_MAX, todayEastern } from '@/lib/shift-notes/validate';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { highlightSegments, matchesTerm } from '@/lib/sops/search';
import { attachmentSrc, ShiftNoteViewer } from './ShiftNoteViewer';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const primaryButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const selectClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

const textareaClass = `${inputClass} min-h-[100px] w-full`;

interface Viewer {
  email: string;
  isAdmin: boolean;
}

/** Whose notes came back: the whole log, or only this person's. */
type Scope = 'all' | 'mine';

async function readError(res: Response): Promise<string> {
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
function uploadWithProgress(
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
/**
 * Note body with every occurrence of `term` wrapped in <mark>, so a search hit
 * is visible at a glance instead of having to be re-read for. Same styling as
 * the SOP search so the two feel like one feature.
 */
function MarkedBody({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  let offset = 0;
  return (
    <>
      {highlightSegments(text, term).map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.match ? (
          <mark
            key={key}
            className="rounded-sm bg-[var(--pyre-gold)] px-0.5 text-[var(--pyre-black)]"
          >
            {segment.text}
          </mark>
        ) : (
          segment.text
        );
      })}
    </>
  );
}

function formatDay(date: string): string {
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

/** "9:42 PM" in shift wall-clock time, for when the note was written. */
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

export function ShiftNotes() {
  const [notes, setNotes] = useState<ShiftNoteRow[]>([]);
  const [attachments, setAttachments] = useState<Record<string, ShiftNoteAttachmentRow[]>>({});
  const [names, setNames] = useState<PeopleNames>({});
  // Which note's media is open in the lightbox, and which item within it.
  const [lightbox, setLightbox] = useState<{ noteId: string; index: number } | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ email: '', isAdmin: false });
  const [scope, setScope] = useState<Scope>('mine');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Composer. Files start uploading the moment they're picked; each chip
  // tracks its own upload, and submit claims whatever has landed.
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

  // In-flight composer uploads: promises for submit to await, XHRs so a
  // removed chip can abort its transfer.
  const uploadPromises = useRef(new Map<string, Promise<void>>());
  const uploadXhrs = useRef(new Map<string, XMLHttpRequest>());

  // What's uploading onto an existing note right now, by note id — e.g.
  // "2 of 3: uploading IMG_2041.jpg — 63%".
  const [noteUpload, setNoteUpload] = useState<Record<string, string | null>>({});

  // Inline edit (one note at a time).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editBody, setEditBody] = useState('');

  // Filters.
  const [personFilter, setPersonFilter] = useState('all');
  const [query, setQuery] = useState('');

  // Arriving from the global search: ?q= seeds the filter and #note-<id>
  // names the note to scroll to once the log has rendered.
  const landOnRef = useRef<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setQuery(q);
    const hash = window.location.hash;
    if (hash.startsWith('#note-')) landOnRef.current = hash.slice(1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/shift-notes');
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as {
        notes: ShiftNoteRow[];
        attachments?: Record<string, ShiftNoteAttachmentRow[]>;
        people?: PeopleNames;
        viewer?: Viewer;
        scope?: Scope;
      };
      setNotes(data.notes);
      setAttachments(data.attachments ?? {});
      setNames(data.people ?? {});
      if (data.viewer) setViewer(data.viewer);
      if (data.scope) setScope(data.scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shift notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Once the log has painted, scroll to the note a search result pointed at.
  // The hash alone can't do it: the notes arrive after the page does.
  useEffect(() => {
    if (loading || !landOnRef.current) return;
    const target = document.getElementById(landOnRef.current);
    landOnRef.current = null;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [loading]);

  /** Insert `note` into local state at its date-sorted place. */
  const mergeNote = (note: ShiftNoteRow, people: PeopleNames) => {
    setNames((prev) => ({ ...prev, ...people }));
    setNotes((prev) =>
      [...prev.filter((n) => n.id !== note.id), note].sort(
        (a, b) => b.note_date.localeCompare(a.note_date) || a.created_at.localeCompare(b.created_at)
      )
    );
  };

  /** Stable identity for a staged file, so picking the same one twice is a no-op. */
  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

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

  /** Stage composer files, rejecting bad ones immediately; uploads start now. */
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
    setNotice(null);
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
      const data = (await res.json()) as {
        note: ShiftNoteRow;
        attachments: ShiftNoteAttachmentRow[];
        people: PeopleNames;
      };
      mergeNote(data.note, data.people);
      if (data.attachments.length > 0) {
        setAttachments((prev) => ({ ...prev, [data.note.id]: data.attachments }));
      }
      setDraftBody('');
      updateStaged(() => []);
      const attached = data.attachments.length;
      // Fewer claimed than sent only happens in a rare race (a stale staged
      // upload swept mid-submit); the note itself is safe either way.
      const shortfall = attachmentIds.length - attached;
      setNotice(
        `Note added for ${formatDay(data.note.note_date)}.` +
          (attached > 0 ? ` ${attached} file${attached === 1 ? '' : 's'} attached.` : '') +
          (shortfall > 0
            ? ` ${shortfall} file${shortfall === 1 ? '' : 's'} could not be attached — please add ${shortfall === 1 ? 'it' : 'them'} again on the note.`
            : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the note');
    } finally {
      setBusy(false);
      setWaitingUploads(false);
    }
  };

  /** Add media to an existing note (author-or-admin, re-checked server-side). */
  const attachTo = async (noteId: string, list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const files = Array.from(list);
      for (const [index, original] of files.entries()) {
        const problem = checkFile(original);
        if (problem) {
          setError(problem);
          continue;
        }
        const prefix = files.length > 1 ? `${index + 1} of ${files.length}: ` : '';
        const label = (pct: number) => `${prefix}uploading ${original.name} — ${pct}%`;
        setNoteUpload((prev) => ({ ...prev, [noteId]: label(0) }));
        try {
          const file = await downscaleImage(original);
          const form = new FormData();
          form.set('noteId', noteId);
          form.set('file', file);
          const { promise } = uploadWithProgress(form, (pct) =>
            setNoteUpload((prev) => ({ ...prev, [noteId]: label(pct) }))
          );
          const attachment = await promise;
          setAttachments((prev) => ({
            ...prev,
            [noteId]: [...(prev[noteId] ?? []), attachment],
          }));
        } catch (e) {
          // Stop at the first failure so the rest can be retried from the
          // note's own add-media button.
          setError(e instanceof Error ? e.message : 'Upload failed');
          break;
        }
      }
    } finally {
      setNoteUpload((prev) => ({ ...prev, [noteId]: null }));
      setBusy(false);
    }
  };

  // Leaving the page mid-transfer kills the upload; warn only then. Files
  // that finished uploading are safe to abandon — the server sweeps unclaimed
  // ones — so no nagging once transfers settle.
  const uploadsInFlight =
    staged.some((s) => s.status === 'uploading') || Object.values(noteUpload).some(Boolean);
  useEffect(() => {
    if (!uploadsInFlight) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploadsInFlight]);

  const removeAttachment = async (attachment: ShiftNoteAttachmentRow) => {
    if (!window.confirm(`Remove ${attachment.file_name}? This cannot be undone.`)) return;
    setError(null);
    const res = await fetch(`/api/admin/shift-note-media?id=${encodeURIComponent(attachment.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    setAttachments((prev) => {
      // Attachments in the log always belong to a note; staged rows (null
      // note_id) live in the composer chips, not here.
      if (!attachment.note_id) return prev;
      return {
        ...prev,
        [attachment.note_id]: (prev[attachment.note_id] ?? []).filter(
          (a) => a.id !== attachment.id
        ),
      };
    });
  };

  const saveEdit = async () => {
    if (!editId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shift-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, noteDate: editDate, body: editBody }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { note: ShiftNoteRow; people: PeopleNames };
      mergeNote(data.note, data.people);
      setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the note');
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = async (note: ShiftNoteRow) => {
    const hasMedia = (attachments[note.id]?.length ?? 0) > 0;
    const warning = hasMedia
      ? 'Delete this note? Its photos and video go with it. This cannot be undone.'
      : 'Delete this note? This cannot be undone.';
    if (!window.confirm(warning)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/shift-notes?id=${note.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setAttachments((prev) => {
        const { [note.id]: _gone, ...rest } = prev;
        return rest;
      });
      if (editId === note.id) setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the note');
    } finally {
      setBusy(false);
    }
  };

  const canTouch = (note: ShiftNoteRow) =>
    viewer.isAdmin || (!!viewer.email && note.author_email === viewer.email);

  // Author options for the filter, ordered by display name.
  const authorOptions = useMemo(() => {
    const set = new Set(notes.map((n) => n.author_email));
    return [...set].sort((a, b) => personName(a, names).localeCompare(personName(b, names)));
  }, [notes, names]);

  // The trimmed term drives both the filter and the highlight, so what marks
  // is exactly what matched.
  const term = query.trim();

  const visible = useMemo(() => {
    return notes.filter((note) => {
      if (scope === 'all' && personFilter !== 'all' && note.author_email !== personFilter) {
        return false;
      }
      // Same matcher as the highlight, so what filters is what marks.
      if (term && !matchesTerm(note.body, term)) return false;
      return true;
    });
  }, [notes, personFilter, term, scope]);

  // The lightbox browses one note's photos and videos (PDFs open in a tab).
  const viewable = useCallback(
    (noteId: string) =>
      (attachments[noteId] ?? []).filter((a) => a.kind === 'photo' || a.kind === 'video'),
    [attachments]
  );
  const lightboxItems = lightbox ? viewable(lightbox.noteId) : [];
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const navigateLightbox = useCallback(
    (index: number) => setLightbox((prev) => (prev ? { ...prev, index } : prev)),
    []
  );

  // note_date → that day's notes, in the server's order (dates desc,
  // written-order within a day).
  const byDay = useMemo(() => {
    const groups = new Map<string, ShiftNoteRow[]>();
    for (const note of visible) {
      const group = groups.get(note.note_date);
      if (group) group.push(note);
      else groups.set(note.note_date, [note]);
    }
    return [...groups.entries()];
  }, [visible]);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/60">
            Add a shift note
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
          className={textareaClass}
          placeholder="Slow start, packed from 7 on. Tub 2 heater kept short-cycling — logged it in Water. Maya handled a tough guest situation really well."
          maxLength={NOTE_BODY_MAX}
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
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
      </section>

      {notice && (
        <p className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {notes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {scope === 'all' && (
            <label className="flex items-center gap-2 font-mono text-xs text-white/60">
              person
              <select
                className={selectClass}
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
              >
                <option value="all">Anyone</option>
                {authorOptions.map((email) => (
                  <option key={email} value={email}>
                    {personName(email, names)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            type="search"
            className={`${inputClass} min-w-48 flex-1`}
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search shift notes"
          />
          {visible.length !== notes.length && (
            <span className="font-mono text-[10px] text-white/40">
              {visible.length} of {notes.length} notes match.
            </span>
          )}
        </div>
      )}

      {/* Whose log this is, so a non-admin isn't left wondering where the
          rest of the team's notes went. */}
      <p className="font-mono text-xs text-white/40">
        {byDay.length === 0 && notes.length > 0
          ? 'No notes match.'
          : scope === 'all'
            ? notes.length === 0
              ? 'No shift notes yet — every note anyone writes lands here.'
              : 'Every note anyone has written.'
            : notes.length === 0
              ? 'You have not written a shift note yet — add your first above. Only admins read the whole log.'
              : 'The notes you have written. Only admins read the whole log.'}
      </p>

      {byDay.map(([date, dayNotes]) => (
        <section key={date} className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
            {formatDay(date)}
          </h2>
          {dayNotes.map((note) => (
            <article
              key={note.id}
              id={`note-${note.id}`}
              className="scroll-mt-20 rounded border border-white/10 bg-white/5 p-3 target:border-[var(--pyre-gold)]/60"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold">
                  {personName(note.author_email, names)}
                </span>
                <span className="font-mono text-[10px] text-white/40">
                  {formatTime(note.created_at)}
                  {note.updated_by && ` · edited by ${personName(note.updated_by, names)}`}
                </span>
                {canTouch(note) && editId !== note.id && (
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => {
                        setEditId(note.id);
                        setEditDate(note.note_date);
                        setEditBody(note.body);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => void deleteNote(note)}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>
              {editId === note.id ? (
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2 font-mono text-xs text-white/60">
                    shift date
                    <input
                      type="date"
                      className={inputClass}
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                    />
                  </label>
                  <textarea
                    className={textareaClass}
                    maxLength={NOTE_BODY_MAX}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={primaryButtonClass}
                      disabled={busy || !editBody.trim() || !editDate}
                      onClick={() => void saveEdit()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => setEditId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                  <MarkedBody text={note.body} term={term} />
                </p>
              )}
              {(attachments[note.id]?.length ?? 0) > 0 && (
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(attachments[note.id] ?? []).map((attachment) => {
                    const src = attachmentSrc(attachment);
                    const openViewer = () =>
                      setLightbox({
                        noteId: note.id,
                        index: Math.max(
                          0,
                          viewable(note.id).findIndex((a) => a.id === attachment.id)
                        ),
                      });
                    return (
                      <li
                        key={attachment.id}
                        className="rounded border border-white/10 bg-white/5 p-1.5"
                      >
                        {attachment.kind === 'photo' ? (
                          <button
                            type="button"
                            onClick={openViewer}
                            aria-label={`View ${attachment.file_name}`}
                            className="block w-full cursor-zoom-in"
                          >
                            <img
                              src={src}
                              alt={attachment.file_name}
                              loading="lazy"
                              className="h-24 w-full rounded object-cover"
                            />
                          </button>
                        ) : attachment.kind === 'video' ? (
                          <button
                            type="button"
                            onClick={openViewer}
                            aria-label={`Play ${attachment.file_name}`}
                            className="relative block w-full cursor-zoom-in"
                          >
                            <video
                              src={src}
                              muted
                              playsInline
                              preload="metadata"
                              tabIndex={-1}
                              className="pointer-events-none h-24 w-full rounded bg-black object-contain"
                            />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="rounded border border-white/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white">
                                Play
                              </span>
                            </span>
                          </button>
                        ) : (
                          <a
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            className="flex h-24 w-full items-center justify-center rounded bg-white/5 font-mono text-xs uppercase tracking-wide text-white/40"
                          >
                            PDF
                          </a>
                        )}
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-white/30">
                          <span className="min-w-0 flex-1 truncate" title={attachment.file_name}>
                            {attachment.file_name}
                          </span>
                          <a href={`${src}&download=1`} className="uppercase hover:text-white">
                            download
                          </a>
                          {canTouch(note) && (
                            <button
                              type="button"
                              className="hover:text-[var(--pyre-red)]"
                              aria-label={`Remove ${attachment.file_name}`}
                              onClick={() => void removeAttachment(attachment)}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canTouch(note) &&
                editId !== note.id &&
                (attachments[note.id]?.length ?? 0) < MAX_ATTACHMENTS_PER_NOTE && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-white/40 hover:text-white">
                      add photos / video
                      <input
                        type="file"
                        accept={ACCEPT_ATTRIBUTE}
                        multiple
                        className="hidden"
                        disabled={busy}
                        onChange={(e) => {
                          void attachTo(note.id, e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {noteUpload[note.id] && (
                      <span aria-busy className="font-mono text-[10px] text-white/40">
                        {noteUpload[note.id]}
                      </span>
                    )}
                  </div>
                )}
            </article>
          ))}
        </section>
      ))}

      {lightbox && lightboxItems.length > 0 && (
        <ShiftNoteViewer
          items={lightboxItems}
          index={Math.min(lightbox.index, lightboxItems.length - 1)}
          onNavigate={navigateLightbox}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
