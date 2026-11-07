// Who may be @-mentioned on a board's cards and goals: everyone who can open
// one of the boards involved. The mention syntax itself, and the reading and
// drawing of mentions, are shared with every other conversation in the
// dashboard (lib/mentions).
import { type MentionCandidate, mentionCandidates } from '@/lib/mentions';
import type { RosterRow } from '@/lib/notifications/recipients';
import { accessOf } from '@/lib/notifications/recipients';
import { canManageBoards, canViewBoard } from './access';

/** Board access is independent of `active`, which means available to schedule. */
export function mentionPeople(rows: RosterRow[], slugs: string[]): MentionCandidate[] {
  return mentionCandidates(rows, (row) => {
    const access = accessOf(row);
    return canManageBoards(access) || slugs.some((slug) => canViewBoard(access, slug));
  });
}
