// Shift notes (/admin/shift-notes). A composer on top — pick the shift date,
// write what the next crew or the admins should know, attach photos or video
// backing what you saw — and the log below, grouped by shift date, newest
// first. Everyone who can see the page reads the whole log; edit/delete shows
// on your own notes (or all of them for admins) and the API re-checks either
// way. Media is staged in the composer and uploaded right after the note is
// created (notes get their id from the server), and can also be added to or
// removed from an existing note by whoever could edit it.
import { useCallback, useEffect, useMemo, useState } from 'react';
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

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** "Thursday, Aug 21" (+ year when it isn't this year). */
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
  const [viewer, setViewer] = useState<Viewer>({ email: '', isAdmin: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Composer. Files wait here until the note exists to attach them to.
  const [draftDate, setDraftDate] = useState(todayEastern);
  const [draftBody, setDraftBody] = useState('');
  const [draftFiles, setDraftFiles] = useState<File[]>([]);

  // Inline edit (one note at a time).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editBody, setEditBody] = useState('');

  // Filters.
  const [personFilter, setPersonFilter] = useState('all');
  const [query, setQuery] = useState('');

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
      };
      setNotes(data.notes);
      setAttachments(data.attachments ?? {});
      setNames(data.people ?? {});
      if (data.viewer) setViewer(data.viewer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shift notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Insert `note` into local state at its date-sorted place. */
  const mergeNote = (note: ShiftNoteRow, people: PeopleNames) => {
    setNames((prev) => ({ ...prev, ...people }));
    setNotes((prev) =>
      [...prev.filter((n) => n.id !== note.id), note].sort(
        (a, b) => b.note_date.localeCompare(a.note_date) || a.created_at.localeCompare(b.created_at)
      )
    );
  };

  /**
   * Upload files to a note one at a time, downscaling photos first. Merges
   * each attachment into local state as it lands; stops (and shows the error)
   * on the first failure so the rest can be retried from the note's own
   * add-media buttons. Returns how many made it.
   */
  const uploadFiles = async (noteId: string, files: File[]): Promise<number> => {
    let uploaded = 0;
    for (const original of files) {
      const problem = checkFile(original);
      if (problem) {
        setError(problem);
        continue;
      }
      const file = await downscaleImage(original);
      const body = new FormData();
      body.set('noteId', noteId);
      body.set('file', file);
      const res = await fetch('/api/admin/shift-note-media', { method: 'POST', body });
      if (!res.ok) {
        setError(await readError(res));
        break;
      }
      const data = (await res.json()) as { attachment: ShiftNoteAttachmentRow };
      setAttachments((prev) => ({
        ...prev,
        [noteId]: [...(prev[noteId] ?? []), data.attachment],
      }));
      uploaded += 1;
    }
    return uploaded;
  };

  /** Stable identity for a staged file, so picking the same one twice is a no-op. */
  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  /** Stage composer files, rejecting bad ones immediately. */
  const stageFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    const good: File[] = [];
    for (const file of Array.from(list)) {
      const problem = checkFile(file);
      if (problem) setError(problem);
      else good.push(file);
    }
    setDraftFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const fresh = good.filter((file) => !seen.has(fileKey(file)));
      return [...prev, ...fresh].slice(0, MAX_ATTACHMENTS_PER_NOTE);
    });
  };

  const addNote = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shift-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteDate: draftDate, body: draftBody }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { note: ShiftNoteRow; people: PeopleNames };
      mergeNote(data.note, data.people);
      setDraftBody('');
      // The note exists now, so a failed upload leaves the text safe — the
      // error shows and the files can be re-added on the note itself.
      const uploaded = draftFiles.length > 0 ? await uploadFiles(data.note.id, draftFiles) : 0;
      setDraftFiles([]);
      setNotice(
        `Note added for ${formatDay(data.note.note_date)}.` +
          (uploaded > 0 ? ` ${uploaded} file${uploaded === 1 ? '' : 's'} attached.` : '')
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the note');
    } finally {
      setBusy(false);
    }
  };

  /** Add media to an existing note (author-or-admin, re-checked server-side). */
  const attachTo = async (noteId: string, list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await uploadFiles(noteId, Array.from(list));
    } finally {
      setBusy(false);
    }
  };

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
    setAttachments((prev) => ({
      ...prev,
      [attachment.note_id]: (prev[attachment.note_id] ?? []).filter((a) => a.id !== attachment.id),
    }));
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (personFilter !== 'all' && note.author_email !== personFilter) return false;
      if (q && !note.body.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notes, personFilter, query]);

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
        {draftFiles.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {draftFiles.map((file) => (
              <li
                key={fileKey(file)}
                className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] text-white/60"
              >
                <span className="max-w-40 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="text-white/30">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className="text-white/40 hover:text-[var(--pyre-red)]"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setDraftFiles((prev) => prev.filter((f) => f !== file))}
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
            Add note
          </button>
          <label className={`${buttonClass} cursor-pointer`}>
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy || draftFiles.length >= MAX_ATTACHMENTS_PER_NOTE}
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
              disabled={busy || draftFiles.length >= MAX_ATTACHMENTS_PER_NOTE}
              onChange={(e) => {
                stageFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {busy && draftFiles.length > 0 && (
            <span className="font-mono text-xs text-white/40">Uploading…</span>
          )}
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

      {byDay.length === 0 && (
        <p className="font-mono text-xs text-white/40">
          {notes.length === 0 ? 'No shift notes yet — yours can be the first.' : 'No notes match.'}
        </p>
      )}

      {byDay.map(([date, dayNotes]) => (
        <section key={date} className="space-y-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-white/50">
            {formatDay(date)}
          </h2>
          {dayNotes.map((note) => (
            <article key={note.id} className="rounded border border-white/10 bg-white/5 p-3">
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
                <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">{note.body}</p>
              )}
              {(attachments[note.id]?.length ?? 0) > 0 && (
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(attachments[note.id] ?? []).map((attachment) => {
                    const src = `/api/admin/shift-note-media?id=${encodeURIComponent(attachment.id)}`;
                    return (
                      <li
                        key={attachment.id}
                        className="rounded border border-white/10 bg-white/5 p-1.5"
                      >
                        {attachment.kind === 'photo' ? (
                          <a href={src} target="_blank" rel="noreferrer">
                            <img
                              src={src}
                              alt={attachment.file_name}
                              loading="lazy"
                              className="h-24 w-full rounded object-cover"
                            />
                          </a>
                        ) : attachment.kind === 'video' ? (
                          // biome-ignore lint/a11y/useMediaCaption: shift footage has no caption track
                          <video
                            src={src}
                            controls
                            preload="metadata"
                            className="h-24 w-full rounded bg-black object-contain"
                          />
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
                  <div className="mt-2">
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
                  </div>
                )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
