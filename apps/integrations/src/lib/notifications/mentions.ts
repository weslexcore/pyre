// @-mentions → the inbox of whoever was named. Every surface where people
// write to each other (lib/mentions) calls this once per write: the
// mentions among the people allowed on that subject get a 'mention' row,
// and the caller leaves them out of the ordinary notice for the same event,
// so being named in a reply reads as one bell row, not two. On an edit, only
// the people the new text adds are told. Best-effort, like every notifier.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import {
  type MentionPerson,
  mentionedEmails,
  mentionsAsNames,
  namesOf,
  newMentions,
} from '@/lib/mentions';
import { createNotifications, type NotificationInput } from './notify';
import { nameFor } from './recipients';
import { mentionText } from './text';
import { daysFromNow, excerpt } from './types';

/** A month: long enough to still be useful, short enough to clear out. */
const MENTION_NOTICE_DAYS = 30;

export interface MentionNotice {
  /** The words as saved. */
  text: string;
  /** The text before an edit; only mentions it lacked are new. Omit for a new entry. */
  previousText?: string | null;
  /** Who may be named here — the subject's readers (lib/mentions). */
  people: readonly MentionPerson[];
  actorEmail: string;
  /** Completes "X mentioned you in …": 'a reply on "Towel count"'. */
  where: string;
  href: NotificationInput['href'];
  source: NotificationInput['source'];
  expiresAt?: string | null;
}

/**
 * Tell the people `text` names. Returns their emails (the actor and anyone
 * not in `people` are never among them), whether or not storage took the
 * rows — the caller uses the list to keep them out of the generic notice.
 */
export async function notifyMentions(db: SupabaseClient, input: MentionNotice): Promise<string[]> {
  const actor = input.actorEmail.trim().toLowerCase();
  const mentioned = (
    input.previousText == null
      ? mentionedEmails(input.text, input.people)
      : newMentions(input.previousText, input.text, input.people)
  ).filter((email) => email !== actor);
  if (mentioned.length === 0) return [];

  const rows = (await listStaff()) ?? [];
  await createNotifications(db, mentioned, {
    kind: 'mention',
    ...mentionText({
      actorName: nameFor(rows, actor),
      where: input.where,
      excerpt: excerpt(mentionsAsNames(input.text, namesOf(input.people)), 160),
    }),
    href: input.href,
    source: input.source,
    actorEmail: actor,
    expiresAt: input.expiresAt === undefined ? daysFromNow(MENTION_NOTICE_DAYS) : input.expiresAt,
  });
  return mentioned;
}

/** `recipients` minus the people a mention notice already reached. */
export function withoutMentioned(
  recipients: Iterable<string>,
  mentioned: readonly string[]
): string[] {
  const skip = new Set(mentioned);
  return [...recipients].filter((email) => !skip.has((email ?? '').trim().toLowerCase()));
}
