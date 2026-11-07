// Card discussion and change history are separate views of the same event log.
// Goals retain their combined feed. Posting a comment uses the existing API.
//
// A card comment can carry files: each one uploads the moment it is picked
// (staged, as a files field's do) and the comment claims them when it is
// posted. A comment may be files alone. A goal has no board to keep files
// on, so its comments are words only.

import { type FormEvent, useMemo, useState } from 'react';
import { formButtonClass } from '@/components/admin/ui';
import { type AttachmentSummary, adminAttachmentHref } from '@/lib/boards/files';
import { BOARD_LIMITS } from '@/lib/boards/types';
import { sendJson } from '@/lib/client/api';
import { useCachedJson } from '@/lib/client/cachedJson';
import { isTempId, optimistic, tempId } from '@/lib/client/optimistic';
import type { BoardColumnRow, BoardEventRow } from '@/lib/db';
import { describeEvent, timeAgo } from '@/lib/goals/history';
import { type MentionPerson, namesOf } from '@/lib/mentions';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { FilesField } from '../boards/FilesField';
import { SectionTitle, textareaClass } from '../goalsUi';
import { MentionTextarea } from '../MentionTextarea';
import { SopMarkdown } from '../SopMarkdown';

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
  viewerEmail,
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
  /** Who is writing, so a comment still on its way carries their name. */
  viewerEmail?: string;
}) {
  const [note, setNote] = useState('');
  // The files picked for the comment being written, already uploaded.
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Remounts the picker after a post, so its tiles start empty.
  const [pickerKey, setPickerKey] = useState(0);
  const takesFiles = Boolean(cardId && boardId);
  const [error, setError] = useState<string | null>(null);

  const query = cardId ? `cardId=${cardId}` : goalId ? `goalId=${goalId}` : '';

  // Cached across drawers and navigations: reopening a card paints its
  // discussion at once and revalidates behind it.
  const feed = useCachedJson<EventsResponse>(query ? `/api/admin/board-events?${query}` : null);
  const events = feed.data?.events ?? [];
  const mentionPeople = feed.data?.mentionPeople ?? [];
  const attachments = feed.data?.attachments ?? [];
  // The candidates' names too, so a comment still on its way draws its
  // mentions as names before the server's directory arrives.
  const names = useMemo(
    () => ({ ...people, ...namesOf(mentionPeople), ...(feed.data?.people ?? {}) }),
    [people, mentionPeople, feed.data]
  );
  const loading = feed.loading;

  const comments = events.filter((entry) => entry.action === 'comment');
  const activity = events.filter((entry) => entry.action !== 'comment');

  // The comment is on the page the moment it is sent — a pending entry at
  // the top, under the writer's name — and the composer is clear for the
  // next one. The server's entry (its id, its files) takes the pending one's
  // place when it lands; a refused post withdraws it with the API's message
  // and hands the words back to the composer.
  const comment = async (event: FormEvent) => {
    event.preventDefault();
    const body = note.trim();
    if ((!body && files.length === 0) || uploading) return;
    const pendingId = tempId();
    const pending: BoardEventRow = {
      id: pendingId,
      goal_id: goalId ?? null,
      card_id: cardId ?? null,
      action: 'comment',
      actor: viewerEmail ?? '',
      detail: files.length > 0 ? { files: files.length } : {},
      note: body,
      created_at: new Date().toISOString(),
    };
    const sentFiles = files;
    setError(null);
    setNote('');
    setFiles([]);
    setPickerKey((n) => n + 1);
    await optimistic(
      feed.setData,
      (current) => ({ ...current, events: [...(current?.events ?? []), pending] }),
      () =>
        sendJson<{ event: BoardEventRow; attachments?: AttachmentSummary[] }>(
          '/api/admin/board-events',
          'POST',
          {
            cardId,
            goalId,
            note: body,
            ...(sentFiles.length > 0 ? { attachmentIds: sentFiles } : {}),
          }
        ),
      {
        reconcile: (current, posted) => ({
          ...current,
          events: (current?.events ?? []).map((entry) =>
            entry.id === pendingId ? posted.event : entry
          ),
          attachments: [...(current?.attachments ?? []), ...(posted.attachments ?? [])],
        }),
        onError: (message) => {
          setError(message);
          setNote(body);
          setFiles(sentFiles);
        },
      }
    );
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
        <MentionTextarea
          id={`comment-${cardId ?? goalId}`}
          className={`${textareaClass} min-h-[70px]`}
          maxLength={BOARD_LIMITS.comment}
          placeholder="Add a comment… Type @ to mention someone"
          value={note}
          onChange={setNote}
          people={mentionPeople}
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
              onBusyChange={setUploading}
              onChange={(ids) => setFiles(ids ?? [])}
            />
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            className={formButtonClass}
            disabled={uploading || (!note.trim() && files.length === 0)}
          >
            {uploading ? 'Uploading…' : 'Comment'}
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
        // A comment still on its way to the server sits dimmed until it lands.
        <li
          key={entry.id}
          className={`flex gap-2 text-sm ${isTempId(entry.id) ? 'opacity-60' : ''}`}
        >
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
              <span className="text-[var(--pyre-creme)]">
                {entry.actor ? personName(entry.actor, people) : 'You'}
              </span>
              {entry.note?.trim() && (
                <div className="[&>div>:first-child]:mt-0 [&>div>:last-child]:mb-0">
                  <SopMarkdown content={entry.note} mentions={people} />
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
