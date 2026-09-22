// Goals and boards activity → people's inboxes. Best-effort, like every
// notifier here: a bell row that fails to write must never fail the thing it
// describes — the card was assigned, the goal was completed.
//
// Who hears about what follows the grants exactly:
//
//   * a card's owner hears when it is put on them and when somebody else
//     finishes it; they never hear about their own doing.
//   * a goal's owner hears when it is marked completed by someone else. The
//     founders are the audience for that one, and it is the moment the whole
//     tool exists for, so it carries the note they wrote. The link opens the
//     board that serves the goal, since that is where a goal lives now.
//   * a comment reaches its owner and explicitly mentioned people with access.
//   * a lead from the web reaches whoever holds that board (boardRecipients),
//     which for the rental pipeline is the community manager and the
//     founders, and for nobody else at all.
//
// Links are per recipient: a deep link to a page somebody cannot open is
// worse than no link, so the href is null unless their grants reach it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import { canViewBoard } from '@/lib/boards/access';
import { mentionedEmails, mentionPeople } from '@/lib/boards/mentions';
import type { BoardCardRow, BoardColumnRow, BoardRow, GoalRow } from '@/lib/db';
import { ALL_TASKS_HREF } from '@/lib/goals/types';
import { createNotifications } from './notify';
import {
  boardRecipients,
  canOpenBoards,
  nameFor,
  type RosterRow,
  rosterByEmail,
} from './recipients';
import {
  boardCommentText,
  cardAssignedText,
  cardCompletedText,
  goalCompletedText,
  intakeCardText,
} from './text';
import { daysFromNow, excerpt } from './types';

/** A month is long enough to still be useful and short enough to clear out. */
const NOTICE_DAYS = 30;

const KIND = 'goal_activity' as const;

type CardSubject = Pick<BoardCardRow, 'id' | 'title' | 'owner_email' | 'due_date' | 'goal_id'>;

function normalize(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Where a card opens for this person. Its own board when they hold it,
 * All Tasks when they hold the tool but somehow not the board, and nowhere
 * when neither — the row still appears, it just isn't a link.
 */
function cardHrefFor(rows: RosterRow[], boardSlug: string, cardId: string) {
  const byEmail = rosterByEmail(rows);
  return (recipient: string): string | null => {
    const row = byEmail.get(recipient);
    if (!row) return null;
    const access = { isAdmin: row.is_admin, pages: row.pages ?? [] };
    if (canViewBoard(access, boardSlug)) return `/admin/boards/${boardSlug}#card-${cardId}`;
    if (canOpenBoards(row)) return `${ALL_TASKS_HREF}#card-${cardId}`;
    return null;
  };
}

/**
 * Where a goal opens: the board that serves it, for whoever holds that
 * board. A goal no board serves has no page, so no link.
 */
function goalHrefFor(rows: RosterRow[], board: Pick<BoardRow, 'slug'> | null) {
  const byEmail = rosterByEmail(rows);
  return (recipient: string): string | null => {
    const row = byEmail.get(recipient);
    if (!row || !board) return null;
    const access = { isAdmin: row.is_admin, pages: row.pages ?? [] };
    return canViewBoard(access, board.slug) ? `/admin/boards/${board.slug}` : null;
  };
}

/**
 * A card was put on somebody. Superseded, so reassigning a task back and
 * forth while planning leaves one unread row rather than a trail of them.
 */
export async function notifyCardAssigned(
  db: SupabaseClient,
  card: CardSubject,
  board: Pick<BoardRow, 'slug' | 'card_noun'>,
  goalTitle: string | null,
  actorEmail: string
): Promise<void> {
  const owner = normalize(card.owner_email);
  if (!owner || owner === normalize(actorEmail)) return;

  const rows = (await listStaff()) ?? [];
  await createNotifications(db, [owner], {
    kind: KIND,
    ...cardAssignedText({
      cardTitle: card.title,
      assignerName: nameFor(rows, actorEmail),
      noun: board.card_noun,
      goalTitle,
      dueDate: card.due_date,
    }),
    href: cardHrefFor(rows, board.slug, card.id),
    source: { type: 'board_card', id: card.id },
    actorEmail,
    expiresAt: daysFromNow(NOTICE_DAYS),
    supersede: true,
  });
}

/** Somebody else finished a card its owner was carrying. */
export async function notifyCardCompleted(
  db: SupabaseClient,
  card: CardSubject,
  board: Pick<BoardRow, 'slug' | 'card_noun'>,
  column: Pick<BoardColumnRow, 'label'>,
  actorEmail: string
): Promise<void> {
  const owner = normalize(card.owner_email);
  if (!owner || owner === normalize(actorEmail)) return;

  const rows = (await listStaff()) ?? [];
  await createNotifications(db, [owner], {
    kind: KIND,
    ...cardCompletedText({
      cardTitle: card.title,
      finisherName: nameFor(rows, actorEmail),
      columnLabel: column.label,
      noun: board.card_noun,
    }),
    href: cardHrefFor(rows, board.slug, card.id),
    source: { type: 'board_card', id: card.id },
    actorEmail,
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
}

/**
 * A goal was called met. The one notification here that is not about a task
 * moving — it is the decision the whole tool is built around, so it carries
 * what the person wrote when they made it.
 */
export async function notifyGoalCompleted(
  db: SupabaseClient,
  goal: Pick<GoalRow, 'id' | 'title' | 'owner_email' | 'completion_note'>,
  board: Pick<BoardRow, 'slug'> | null,
  preview: { kpisMet: number; kpisTotal: number; openCards: number },
  actorEmail: string
): Promise<void> {
  const owner = normalize(goal.owner_email);
  if (!owner || owner === normalize(actorEmail)) return;

  const rows = (await listStaff()) ?? [];
  await createNotifications(db, [owner], {
    kind: KIND,
    ...goalCompletedText({
      goalTitle: goal.title,
      finisherName: nameFor(rows, actorEmail),
      kpisMet: preview.kpisMet,
      kpisTotal: preview.kpisTotal,
      openCards: preview.openCards,
      note: goal.completion_note,
    }),
    href: goalHrefFor(rows, board),
    source: { type: 'goal', id: goal.id },
    actorEmail,
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
}

/** A comment reaches its owner and mentioned users with access. */
export async function notifyCardComment(
  db: SupabaseClient,
  card: CardSubject,
  board: Pick<BoardRow, 'slug'>,
  note: string,
  actorEmail: string
): Promise<void> {
  const owner = normalize(card.owner_email);

  const rows = (await listStaff()) ?? [];
  const mentions = mentionedEmails(note, mentionPeople(rows, [board.slug]));
  await createNotifications(db, [owner, ...mentions], {
    kind: KIND,
    ...boardCommentText({
      subjectTitle: card.title,
      commenterName: nameFor(rows, actorEmail),
      excerpt: excerpt(note, 160),
    }),
    href: cardHrefFor(rows, board.slug, card.id),
    source: { type: 'board_card', id: card.id },
    actorEmail,
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
}

/** A goal comment reaches its owner and mentioned users with access. */
export async function notifyGoalComment(
  db: SupabaseClient,
  goal: Pick<GoalRow, 'id' | 'title' | 'owner_email'>,
  board: Pick<BoardRow, 'slug'> | null,
  note: string,
  actorEmail: string,
  boards: Pick<BoardRow, 'slug'>[] = board ? [board] : []
): Promise<void> {
  const owner = normalize(goal.owner_email);

  const rows = (await listStaff()) ?? [];
  const mentions = mentionedEmails(
    note,
    mentionPeople(
      rows,
      boards.map((item) => item.slug)
    )
  );
  await createNotifications(db, [owner, ...mentions], {
    kind: KIND,
    ...boardCommentText({
      subjectTitle: goal.title,
      commenterName: nameFor(rows, actorEmail),
      excerpt: excerpt(note, 160),
    }),
    href: (recipient) =>
      boards.map((item) => goalHrefFor(rows, item)(recipient)).find(Boolean) ?? null,
    source: { type: 'goal', id: goal.id },
    actorEmail,
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
}

/**
 * A lead arrived from the web. This is the one notice nobody caused, so it
 * has no actor to exclude — everyone who holds the board hears, which is the
 * point of routing enquiries here instead of into somebody's inbox.
 */
export async function notifyIntakeCard(
  db: SupabaseClient,
  card: Pick<BoardCardRow, 'id' | 'title'>,
  board: Pick<BoardRow, 'slug' | 'name' | 'card_noun'>,
  via?: string
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  await createNotifications(db, boardRecipients(rows, board.slug), {
    kind: KIND,
    ...intakeCardText({
      cardTitle: card.title,
      boardName: board.name,
      noun: board.card_noun,
      via,
    }),
    href: cardHrefFor(rows, board.slug, card.id),
    source: { type: 'board_card', id: card.id },
    actorEmail: null,
    expiresAt: daysFromNow(NOTICE_DAYS),
  });
}
