// Shift notes (/admin/shift-notes). A composer on top (ShiftNoteComposer —
// the same one the header's plus button opens in a modal) and the log below,
// grouped by shift date, newest first, with the most recent entry for a day
// at the top of that day. A note written from either composer lands in the
// log via SHIFT_NOTE_CREATED_EVENT, no reload needed.
// Everyone on the roster writes notes; what the log holds depends on
// who is reading it — an admin gets everyone's, everyone else only their own
// — so a non-admin's view is entirely theirs to edit and needs no person
// filter. The server decides all of that (the island only renders what came
// back, and every mutation is re-checked). Media can also be added to or
// removed from an existing note.
// Clicking a photo or video opens it in the ShiftNoteViewer lightbox, which
// steps through that note's media without leaving the page.
//
// Each note also carries a triage status — open, to do, resolved — that only
// admins flip, so a request or piece of feedback gets tracked to completion,
// and an activity thread: comments, in which an admin responds in context and
// the author replies back, and an entry for every action on the note — each
// status change, each edit, each time the classifier read it — so the note's history
// reads in order. Entries show to whoever sees the note; an admin can mark a
// comment private, which keeps it among the admins, and the classifier's entries are
// admins-only (the server never sends those to anyone else).
//
// For admins, each note also shows what the classifier found in it — actions to take,
// questions to answer, records to update, feedback, safety concerns
// (Signals.tsx, lib/classify) — and the log can be filtered by them. The
// read happens in the background after a note is saved, so the note appears
// at once marked "Reading…" and its chips fill in a few seconds later; an
// edit to its text is read again, and an admin can run the classifier on any note.
// A note no admin has triaged yet follows what the classifier found: to do
// when anything is actionable, resolved when it is purely informational
// (lib/shift-notes/triage); an admin's status always wins.
// The page never names the model behind it (lib/classify picks that), so
// swapping models changes nothing here.
import { readStoredSignals, type SignalType } from '@pyre/signals-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassificationView } from '@/lib/classify/view';
import type {
  ShiftNoteAttachmentRow,
  ShiftNoteReplyRow,
  ShiftNoteRow,
  ShiftNoteStatus,
} from '@/lib/db';
import {
  canReply,
  canSeeNote,
  canSetStatus,
  canTouchReply,
  SHIFT_NOTE_STATUSES,
  statusLabel,
} from '@/lib/shift-notes/access';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  MAX_ATTACHMENTS_PER_NOTE,
} from '@/lib/shift-notes/media';
import { NOTE_BODY_MAX, REPLY_BODY_MAX } from '@/lib/shift-notes/validate';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { highlightSegments, matchesTerm } from '@/lib/sops/search';
import {
  buttonClass,
  type CreatedShiftNote,
  formatDay,
  inputClass,
  primaryButtonClass,
  readError,
  SHIFT_NOTE_CREATED_EVENT,
  ShiftNoteComposer,
  textareaClass,
  uploadWithProgress,
} from './ShiftNoteComposer';
import { attachmentSrc, ShiftNoteViewer } from './ShiftNoteViewer';
import {
  CHIP_CLASS,
  hasSignal,
  SignalChips,
  SignalFilter,
  SignalList,
  SparkleIcon,
  useClassifications,
} from './Signals';

const selectClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

const replyTextareaClass = `${inputClass} min-h-[60px] w-full`;

/** Badge colours per status: quiet while open, gold while owed, sage once done. */
const statusBadgeClass: Record<ShiftNoteStatus, string> = {
  open: 'border-white/15 text-white/40',
  todo: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  resolved: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
};

/**
 * What an activity event says, after the actor's name: "moved this from Open
 * to To do", "edited the text". Comments render as themselves, not here.
 */
function describeEvent(entry: ShiftNoteReplyRow): string {
  const data = entry.data ?? {};
  switch (entry.kind) {
    case 'status':
      if (!data.to) return 'changed the status';
      return data.from
        ? `moved this from ${statusLabel(data.from)} to ${statusLabel(data.to)}`
        : `marked this ${statusLabel(data.to)}`;
    case 'edit': {
      const parts = (data.fields ?? []).map((f) => (f === 'body' ? 'the text' : 'the shift date'));
      return parts.length > 0 ? `edited ${parts.join(' and ')}` : 'edited the note';
    }
    default:
      return '';
  }
}

function StatusBadge({ status }: { status: ShiftNoteStatus }) {
  return <span className={`${CHIP_CLASS} ${statusBadgeClass[status]}`}>{statusLabel(status)}</span>;
}

interface Viewer {
  email: string;
  isAdmin: boolean;
}

/** Whose notes came back: the whole log, or only this person's. */
type Scope = 'all' | 'mine';

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

/** "Aug 21, 9:42 PM" in shift wall-clock time, for replies and status changes. */
function formatStamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
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
  // Each note's thread, in writing order (only the replies this viewer may see).
  const [replies, setReplies] = useState<Record<string, ShiftNoteReplyRow[]>>({});
  const [names, setNames] = useState<PeopleNames>({});
  // Which note's media is open in the lightbox, and which item within it.
  const [lightbox, setLightbox] = useState<{ noteId: string; index: number } | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ email: '', isAdmin: false });
  const [scope, setScope] = useState<Scope>('mine');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // What's uploading onto an existing note right now, by note id — e.g.
  // "2 of 3: uploading IMG_2041.jpg — 63%".
  const [noteUpload, setNoteUpload] = useState<Record<string, string | null>>({});

  // Inline edit (one note at a time).
  const [editId, setEditId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editBody, setEditBody] = useState('');

  // Reply composer per note (draft text and, for admins, the private flag),
  // and the one reply being edited inline.
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyPrivate, setReplyPrivate] = useState<Record<string, boolean>>({});
  const [replyEditId, setReplyEditId] = useState<string | null>(null);
  const [replyEditBody, setReplyEditBody] = useState('');

  // Filters.
  const [personFilter, setPersonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ShiftNoteStatus>('all');
  const [signalFilter, setSignalFilter] = useState<'all' | SignalType>('all');

  /**
   * Re-read one note and its thread from the server — once the classifier
   * has answered, its reading is in the thread and the note may have moved
   * to To do or Resolved.
   */
  const refreshThread = useCallback(async (noteId: string) => {
    try {
      const res = await fetch(`/api/admin/shift-note-replies?noteId=${encodeURIComponent(noteId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        note: ShiftNoteRow;
        replies: ShiftNoteReplyRow[];
        people: PeopleNames;
      };
      setNames((prev) => ({ ...prev, ...data.people }));
      setNotes((prev) => prev.map((n) => (n.id === noteId ? data.note : n)));
      setReplies((prev) => ({ ...prev, [noteId]: data.replies }));
    } catch {
      // The entry is saved; it shows on the next load.
    }
  }, []);

  // What the classifier found per note — admins only; the server sends
  // nothing to anyone else, and this fetches nothing for them. Each finished
  // read is also an entry in the note's thread, and may triage the note; the
  // worker does both just after the answer, so give it a moment before
  // reading the note back.
  const signals = useClassifications('shift_note', viewer.isAdmin, (noteId, view) => {
    if (view.state === 'done') window.setTimeout(() => void refreshThread(noteId), 1_000);
  });
  const { reset: resetSignals, merge: mergeSignals, remove: removeSignals } = signals;
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
        replies?: Record<string, ShiftNoteReplyRow[]>;
        people?: PeopleNames;
        viewer?: Viewer;
        scope?: Scope;
        classifications?: Record<string, ClassificationView>;
      };
      setNotes(data.notes);
      resetSignals(data.classifications);
      setAttachments(data.attachments ?? {});
      setReplies(data.replies ?? {});
      setNames(data.people ?? {});
      if (data.viewer) setViewer(data.viewer);
      if (data.scope) setScope(data.scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shift notes');
    } finally {
      setLoading(false);
    }
  }, [resetSignals]);

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
  const mergeNote = useCallback((note: ShiftNoteRow, people: PeopleNames) => {
    setNames((prev) => ({ ...prev, ...people }));
    setNotes((prev) =>
      [...prev.filter((n) => n.id !== note.id), note].sort(
        (a, b) => b.note_date.localeCompare(a.note_date) || b.created_at.localeCompare(a.created_at)
      )
    );
  }, []);

  // Every new note — from the composer above or the header's quick-add
  // modal — is announced on the document; fold it into the log.
  useEffect(() => {
    const onCreated = (event: Event) => {
      const {
        note,
        attachments: added,
        people,
        classification,
      } = (event as CustomEvent<CreatedShiftNote>).detail;
      mergeNote(note, people);
      mergeSignals(note.id, classification);
      if (added.length > 0) setAttachments((prev) => ({ ...prev, [note.id]: added }));
    };
    document.addEventListener(SHIFT_NOTE_CREATED_EVENT, onCreated);
    return () => document.removeEventListener(SHIFT_NOTE_CREATED_EVENT, onCreated);
  }, [mergeNote, mergeSignals]);

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

  // Leaving the page mid-transfer kills the upload; warn only then. (The
  // composer guards its own uploads the same way.)
  const uploadsInFlight = Object.values(noteUpload).some(Boolean);
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
      const data = (await res.json()) as {
        note: ShiftNoteRow;
        activity?: ShiftNoteReplyRow[];
        people: PeopleNames;
        classification?: ClassificationView;
      };
      mergeNote(data.note, data.people);
      for (const entry of data.activity ?? []) mergeReply(entry, data.people);
      mergeSignals(data.note.id, data.classification);
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
      setReplies((prev) => {
        const { [note.id]: _gone, ...rest } = prev;
        return rest;
      });
      removeSignals(note.id);
      if (editId === note.id) setEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the note');
    } finally {
      setBusy(false);
    }
  };

  const canTouch = (note: ShiftNoteRow) => canSeeNote(note, viewer);

  /** Admin triage: flip a note's status (re-checked server-side). */
  const setStatus = async (note: ShiftNoteRow, status: ShiftNoteStatus) => {
    if (status === note.status) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shift-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id, status }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as {
        note: ShiftNoteRow;
        activity?: ShiftNoteReplyRow[];
        people: PeopleNames;
      };
      mergeNote(data.note, data.people);
      for (const entry of data.activity ?? []) mergeReply(entry, data.people);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update the status');
    } finally {
      setBusy(false);
    }
  };

  /** Put `reply` into its note's thread at its place in writing order. */
  const mergeReply = (reply: ShiftNoteReplyRow, people: PeopleNames) => {
    setNames((prev) => ({ ...prev, ...people }));
    setReplies((prev) => ({
      ...prev,
      [reply.note_id]: [
        ...(prev[reply.note_id] ?? []).filter((r) => r.id !== reply.id),
        reply,
      ].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
  };

  const addReply = async (note: ShiftNoteRow) => {
    const draft = (replyDrafts[note.id] ?? '').trim();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shift-note-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: note.id,
          body: draft,
          isPrivate: viewer.isAdmin && !!replyPrivate[note.id],
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { reply: ShiftNoteReplyRow; people: PeopleNames };
      mergeReply(data.reply, data.people);
      setReplyDrafts((prev) => ({ ...prev, [note.id]: '' }));
      setReplyPrivate((prev) => ({ ...prev, [note.id]: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add the reply');
    } finally {
      setBusy(false);
    }
  };

  const saveReplyEdit = async () => {
    if (!replyEditId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/shift-note-replies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: replyEditId, body: replyEditBody }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { reply: ShiftNoteReplyRow; people: PeopleNames };
      mergeReply(data.reply, data.people);
      setReplyEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save the reply');
    } finally {
      setBusy(false);
    }
  };

  /** Admin-only: move a reply between the shared thread and the admins. */
  const toggleReplyPrivate = async (reply: ShiftNoteReplyRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/shift-note-replies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reply.id, isPrivate: !reply.is_private }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const data = (await res.json()) as { reply: ShiftNoteReplyRow; people: PeopleNames };
      mergeReply(data.reply, data.people);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update the reply');
    } finally {
      setBusy(false);
    }
  };

  const deleteReply = async (reply: ShiftNoteReplyRow) => {
    if (!window.confirm('Delete this reply? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/shift-note-replies?id=${reply.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(await readError(res));
      setReplies((prev) => ({
        ...prev,
        [reply.note_id]: (prev[reply.note_id] ?? []).filter((r) => r.id !== reply.id),
      }));
      if (replyEditId === reply.id) setReplyEditId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete the reply');
    } finally {
      setBusy(false);
    }
  };

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
      if (statusFilter !== 'all' && note.status !== statusFilter) return false;
      if (signalFilter !== 'all' && !hasSignal(signals.classifications[note.id], signalFilter)) {
        return false;
      }
      // Same matcher as the highlight, so what filters is what marks.
      if (term && !matchesTerm(note.body, term)) return false;
      return true;
    });
  }, [notes, personFilter, statusFilter, signalFilter, signals.classifications, term, scope]);

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

  // note_date → that day's notes, in the server's order (dates desc, and
  // newest-written first within a day).
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
      <section className="rounded border border-white/10 bg-white/5 p-5 sm:p-6">
        <ShiftNoteComposer
          onCreated={(_created, message) => {
            setError(null);
            setNotice(message);
          }}
        />
      </section>

      {notice && (
        <p className="rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/10 px-3 py-2 text-sm text-[var(--pyre-sage)]">
          {notice}
        </p>
      )}
      {(error ?? signals.error) && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error ?? signals.error}
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
          <label className="flex items-center gap-2 font-mono text-xs text-white/60">
            status
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | ShiftNoteStatus)}
            >
              <option value="all">Any status</option>
              {SHIFT_NOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          {viewer.isAdmin && (
            <SignalFilter className={selectClass} value={signalFilter} onChange={setSignalFilter} />
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
              ? 'No notes yet — feedback, issues, and anything worth passing along land here as the team adds them.'
              : 'Every note anyone has left, newest first.'
            : notes.length === 0
              ? 'You have not left a note yet — add one above whenever something comes up, no need to wait for the end of your shift. Only admins read the whole log.'
              : 'The notes you have left, newest first. Only admins read the whole log.'}
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
                {/* Status, then what the classifier found (admins only), on
                    one line: the status is often the classifier's call. */}
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={note.status} />
                  {viewer.isAdmin && signals.classifications[note.id] && (
                    <>
                      <span
                        aria-hidden="true"
                        className="font-mono text-[10px] leading-4 text-white/20"
                      >
                        |
                      </span>
                      <SignalChips classification={signals.classifications[note.id]} />
                    </>
                  )}
                </span>
                {canTouch(note) && editId !== note.id && (
                  <span className="ml-auto flex flex-wrap gap-2">
                    {/* Reads the note and, if no admin has set its status,
                        sorts it into To do or Resolved — so it sits with the
                        note's other actions rather than the chips. */}
                    {viewer.isAdmin && (
                      <button
                        type="button"
                        className={`${buttonClass} flex items-center px-2`}
                        disabled={busy || signals.rerunning === note.id}
                        aria-label={
                          signals.classifications[note.id] ? 'Reclassify note' : 'Classify note'
                        }
                        title="Read this note for anything actionable and, unless an admin has set its status, mark it To do or Resolved"
                        onClick={() => void signals.rerun(note.id)}
                      >
                        {/* Pulses while a read is under way. */}
                        <SparkleIcon
                          className={
                            signals.rerunning === note.id ||
                            signals.classifications[note.id]?.state === 'pending'
                              ? 'animate-pulse'
                              : undefined
                          }
                        />
                      </button>
                    )}
                    {canSetStatus(viewer) &&
                      SHIFT_NOTE_STATUSES.map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`${buttonClass} ${
                            note.status === status
                              ? 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]'
                              : ''
                          }`}
                          aria-pressed={note.status === status}
                          disabled={busy || note.status === status}
                          onClick={() => void setStatus(note, status)}
                        >
                          {statusLabel(status)}
                        </button>
                      ))}
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
              {((replies[note.id]?.length ?? 0) > 0 || canReply(note, viewer)) && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  {(replies[note.id] ?? []).map((reply) =>
                    reply.kind !== 'comment' ? (
                      <ActivityEvent key={reply.id} entry={reply} names={names} />
                    ) : (
                      <div
                        key={reply.id}
                        className={`rounded border px-3 py-2 ${
                          reply.is_private
                            ? 'border-dashed border-white/20 bg-transparent'
                            : 'border-white/10 bg-white/5'
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-xs font-semibold">
                            {personName(reply.author_email ?? '', names)}
                          </span>
                          <span className="font-mono text-[10px] text-white/40">
                            {formatStamp(reply.created_at)}
                            {reply.updated_by &&
                              ` · edited by ${personName(reply.updated_by, names)}`}
                          </span>
                          {reply.is_private && (
                            <span className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
                              admins only
                            </span>
                          )}
                          {canTouchReply(reply, viewer) && replyEditId !== reply.id && (
                            <span className="ml-auto flex gap-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                              <button
                                type="button"
                                className="hover:text-white"
                                disabled={busy}
                                onClick={() => {
                                  setReplyEditId(reply.id);
                                  setReplyEditBody(reply.body);
                                }}
                              >
                                Edit
                              </button>
                              {viewer.isAdmin && (
                                <button
                                  type="button"
                                  className="hover:text-white"
                                  disabled={busy}
                                  onClick={() => void toggleReplyPrivate(reply)}
                                >
                                  {reply.is_private ? 'Share with author' : 'Make private'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="hover:text-[var(--pyre-red)]"
                                disabled={busy}
                                onClick={() => void deleteReply(reply)}
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </div>
                        {replyEditId === reply.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              className={replyTextareaClass}
                              maxLength={REPLY_BODY_MAX}
                              value={replyEditBody}
                              onChange={(e) => setReplyEditBody(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={primaryButtonClass}
                                disabled={busy || !replyEditBody.trim()}
                                onClick={() => void saveReplyEdit()}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className={buttonClass}
                                disabled={busy}
                                onClick={() => setReplyEditId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-white/80">
                            {reply.body}
                          </p>
                        )}
                      </div>
                    )
                  )}
                  {canReply(note, viewer) && (
                    <div className="space-y-2">
                      <textarea
                        className={replyTextareaClass}
                        placeholder={
                          viewer.isAdmin ? 'Reply to this note…' : 'Reply to the admins…'
                        }
                        maxLength={REPLY_BODY_MAX}
                        value={replyDrafts[note.id] ?? ''}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [note.id]: e.target.value }))
                        }
                        aria-label={`Reply to ${personName(note.author_email, names)}'s note`}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy || !(replyDrafts[note.id] ?? '').trim()}
                          onClick={() => void addReply(note)}
                        >
                          Reply
                        </button>
                        {viewer.isAdmin && (
                          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-white/40">
                            <input
                              type="checkbox"
                              checked={!!replyPrivate[note.id]}
                              onChange={(e) =>
                                setReplyPrivate((prev) => ({
                                  ...prev,
                                  [note.id]: e.target.checked,
                                }))
                              }
                            />
                            only admins can see this
                          </label>
                        )}
                      </div>
                    </div>
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

/**
 * One recorded action in a note's thread: a single quiet line (who, what,
 * when), set apart from the comments. The classifier's reads also show what it found.
 */
function ActivityEvent({ entry, names }: { entry: ShiftNoteReplyRow; names: PeopleNames }) {
  const stamp = <span className="text-white/30"> · {formatStamp(entry.created_at)}</span>;
  if (entry.kind === 'classification') {
    const found = readStoredSignals(entry.data?.signals);
    const requestedBy = entry.data?.requested_by;
    return (
      <div className="flex flex-wrap items-center gap-2 px-3 py-1 font-mono text-[10px] text-white/40">
        <span>
          ✦ Classifier read this note
          {requestedBy ? `, run by ${personName(requestedBy, names)}` : ''}
          {found.length === 0 && ' — nothing to act on'}
          {stamp}
        </span>
        {found.length > 0 && <SignalList signals={found} />}
      </div>
    );
  }
  return (
    <p className="px-3 py-1 font-mono text-[10px] text-white/40">
      {/* Unsigned events are the classifier's (e.g. triaging an untriaged note). */}
      <span className="text-white/60">
        {entry.author_email ? personName(entry.author_email, names) : 'Classifier'}
      </span>{' '}
      {describeEvent(entry)}
      {stamp}
    </p>
  );
}
