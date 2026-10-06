// Card discussion and change history are separate views of the same event log.
// Goals retain their combined feed. Posting a comment uses the existing API.
//
// A card comment can carry files: each one uploads the moment it is picked
// (staged, as a files field's do) and the comment claims them when it is
// posted. A comment may be files alone. A goal has no board to keep files
// on, so its comments are words only.

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import { type AttachmentSummary, adminAttachmentHref } from '@/lib/boards/files';
import type { MentionPerson } from '@/lib/boards/mentions';
import { readError, sendJson } from '@/lib/client/api';
import type { BoardColumnRow, BoardEventRow } from '@/lib/db';
import { describeEvent, timeAgo } from '@/lib/goals/history';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { FilesField } from '../boards/FilesField';
import { SectionTitle } from '../goalsUi';
import { SopMarkdown } from '../SopMarkdown';
import { MentionInput } from './MentionInput';

interface EventsResponse {
  events: BoardEventRow[];
  people?: PeopleNames;
  mentionPeople?: MentionPerson[];
  /** A card's comments' files. */
  attachments?: AttachmentSummary[];
}

/** Where a comment's file is uploaded before the comment is posted. */
const COMMENT_UPLOAD = '/api/admin/board-media';

/** Un-pick a staged comment file; one left behind is swept within a day. */
async function unpickCommentFile(id: string) {
  await sendJson(`/api/admin/board-media?id=${encodeURIComponent(id)}`, 'DELETE');
}

export function ActivityFeed({
  cardId,
  boardId,
  goalId,
  subjectTitle,
  columns,
  people,
  heading = 'Activity',
}: {
  /** Exactly one of these; it decides which trail is read and commented on. */
  cardId?: string;
  /** The card's board, where a comment's files are kept; without it, no files. */
  boardId?: string;
  goalId?: string;
  subjectTitle: string;
  columns: BoardColumnRow[];
  people: PeopleNames;
  heading?: string;
}) {
  const [events, setEvents] = useState<BoardEventRow[]>([]);
  const [names, setNames] = useState<PeopleNames>(people);
  const [note, setNote] = useState('');
  const [mentionPeople, setMentionPeople] = useState<MentionPerson[]>([]);
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  // The files picked for the comment being written, already uploaded.
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Remounts the picker after a post, so its tiles start empty.
  const [pickerKey, setPickerKey] = useState(0);
  const takesFiles = Boolean(cardId && boardId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = cardId ? `cardId=${cardId}` : goalId ? `goalId=${goalId}` : '';

  const load = useCallback(async () => {
    if (!query) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/board-events?${query}`);
      if (!res.ok) throw new Error(await readError(res));
      const body = (await res.json()) as EventsResponse;
      setEvents(body.events);
      setMentionPeople(body.mentionPeople ?? []);
      setAttachments(body.attachments ?? []);
      setNames({ ...people, ...(body.people ?? {}) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the activity');
    } finally {
      setLoading(false);
    }
  }, [query, people]);

  useEffect(() => {
    void load();
  }, [load]);

  const comments = events.filter((entry) => entry.action === 'comment');
  const activity = events.filter((entry) => entry.action !== 'comment');

  const comment = async (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if ((!body && files.length === 0) || busy || uploading) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/admin/board-events', 'POST', {
        cardId,
        goalId,
        note: body,
        ...(files.length > 0 ? { attachmentIds: files } : {}),
      });
      setNote('');
      setFiles([]);
      setPickerKey((n) => n + 1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionTitle
        note={
          cardId
            ? String(comments.length)
            : events.length > 0
              ? `${events.length} entries`
              : undefined
        }
      >
        {cardId ? 'Comments' : heading}
      </SectionTitle>

      <form onSubmit={comment} className="mb-3">
        <label className="sr-only" htmlFor={`comment-${cardId ?? goalId}`}>
          Add a comment
        </label>
        <MentionInput
          id={`comment-${cardId ?? goalId}`}
          value={note}
          onChange={setNote}
          people={mentionPeople}
          disabled={busy}
        />
        {takesFiles && boardId && (
          <div className="mt-2">
            <FilesField
              key={pickerKey}
              id={`comment-files-${cardId}`}
              label="this comment"
              value={files}
              action={COMMENT_UPLOAD}
              params={{ boardId, for: 'comment' }}
              href={adminAttachmentHref}
              unpick={unpickCommentFile}
              disabled={busy}
              onBusyChange={setUploading}
              onChange={(ids) => setFiles(ids ?? [])}
            />
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            className={formButtonClass}
            disabled={busy || uploading || (!note.trim() && files.length === 0)}
          >
            {busy ? 'Posting…' : uploading ? 'Uploading…' : 'Comment'}
          </button>
        </div>
      </form>

      {error && <p className="mb-2 text-sm text-[var(--pyre-red)]">{error}</p>}
      <EventEntries
        events={events}
        mode={cardId ? 'comments' : 'all'}
        attachments={attachments}
        loading={loading}
        subjectTitle={subjectTitle}
        columns={columns}
        people={names}
      />
      {cardId && (
        <details className="mt-5 border-t border-white/10 pt-4">
          <summary className="cursor-pointer font-mono text-xs uppercase tracking-wide text-white/50">
            Activity · {activity.length}
          </summary>
          <div className="mt-3">
            <EventEntries
              events={events}
              mode="activity"
              loading={loading}
              subjectTitle={subjectTitle}
              columns={columns}
              people={names}
            />
          </div>
        </details>
      )}
    </section>
  );
}

/** Filter by action, so a note attached to a change stays in the audit trail. */
export function EventEntries({
  events,
  mode,
  attachments = [],
  loading,
  subjectTitle,
  columns,
  people,
}: {
  events: BoardEventRow[];
  mode: 'comments' | 'activity' | 'all';
  /** Files posted with comments, matched to theirs by event_id. */
  attachments?: AttachmentSummary[];
  loading: boolean;
  subjectTitle: string;
  columns: BoardColumnRow[];
  people: PeopleNames;
}) {
  const visible = events.filter(
    (entry) =>
      mode === 'all' ||
      (mode === 'comments' ? entry.action === 'comment' : entry.action !== 'comment')
  );
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const filesByEvent = new Map<string, AttachmentSummary[]>();
  for (const file of attachments) {
    if (!file.event_id) continue;
    filesByEvent.set(file.event_id, [...(filesByEvent.get(file.event_id) ?? []), file]);
  }
  const nowIso = new Date().toISOString();
  if (visible.length === 0) {
    return (
      <p className="font-mono text-xs text-white/35">
        {loading
          ? 'Loading…'
          : mode === 'comments'
            ? 'No comments yet.'
            : mode === 'activity'
              ? 'No changes yet.'
              : 'Nothing has happened here yet.'}
      </p>
    );
  }
  return (
    <ol
      className="space-y-2"
      aria-label={
        mode === 'comments'
          ? 'Comments'
          : mode === 'activity'
            ? 'Activity'
            : 'Activity and comments'
      }
    >
      {[...visible].reverse().map((entry) => (
        <li key={entry.id} className="flex gap-2 text-sm">
          <time
            dateTime={entry.created_at}
            title={new Date(entry.created_at).toLocaleString()}
            className="shrink-0 font-mono text-[11px] text-white/30"
          >
            {timeAgo(entry.created_at, nowIso)}
          </time>
          {entry.action === 'comment' ? (
            // Comments are markdown like every other body in the admin, so
            // links and checklists render; the outer margins are trimmed to
            // keep a one-line comment on one line's worth of space.
            <div className="min-w-0 flex-1 break-words">
              <span className="text-[var(--pyre-creme)]">{personName(entry.actor, people)}</span>
              {entry.note?.trim() && (
                <div className="[&>div>:first-child]:mt-0 [&>div>:last-child]:mb-0">
                  <SopMarkdown content={entry.note} />
                </div>
              )}
              {filesByEvent.has(entry.id) && (
                <div className="mt-2">
                  <FilesField
                    id={`comment-files-${entry.id}`}
                    label="this comment"
                    value={(filesByEvent.get(entry.id) ?? []).map((file) => file.id)}
                    known={filesByEvent.get(entry.id)}
                    action={COMMENT_UPLOAD}
                    params={{}}
                    href={adminAttachmentHref}
                    readOnly
                    onChange={() => undefined}
                  />
                </div>
              )}
            </div>
          ) : (
            <span className="min-w-0 flex-1 break-words">
              <span className="text-[var(--pyre-creme)]">{personName(entry.actor, people)}</span>{' '}
              <span className="text-white/45">
                {describeEvent(entry, subjectTitle, columnsById, people)}
              </span>
              {entry.note && (
                <span className="mt-1 block whitespace-pre-wrap text-white/60">{entry.note}</span>
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
