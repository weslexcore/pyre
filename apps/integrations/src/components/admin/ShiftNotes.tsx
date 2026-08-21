// Shift notes (/admin/shift-notes). A composer on top — pick the shift date,
// write what the next crew or the admins should know — and the log below,
// grouped by shift date, newest first. Everyone who can see the page reads
// the whole log; edit/delete shows on your own notes (or all of them for
// admins) and the API re-checks either way.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShiftNoteRow } from '@/lib/db';
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
  const [names, setNames] = useState<PeopleNames>({});
  const [viewer, setViewer] = useState<Viewer>({ email: '', isAdmin: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Composer.
  const [draftDate, setDraftDate] = useState(todayEastern);
  const [draftBody, setDraftBody] = useState('');

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
        people?: PeopleNames;
        viewer?: Viewer;
      };
      setNotes(data.notes);
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
        (a, b) =>
          b.note_date.localeCompare(a.note_date) || a.created_at.localeCompare(b.created_at)
      )
    );
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
      setNotice(`Note added for ${formatDay(data.note.note_date)}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the note');
    } finally {
      setBusy(false);
    }
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
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/shift-notes?id=${note.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
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
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy || !draftBody.trim() || !draftDate}
          onClick={() => void addNote()}
        >
          Add note
        </button>
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
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
