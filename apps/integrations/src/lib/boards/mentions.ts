import type { RosterRow } from '@/lib/notifications/recipients';
import { canManageBoards, canViewBoard } from './access';

export interface MentionPerson {
  email: string;
  name: string;
}

/** Board access is independent of `active`, which means available to schedule. */
export function mentionPeople(rows: RosterRow[], slugs: string[]): MentionPerson[] {
  return rows
    .filter((row) => {
      const access = { isAdmin: row.is_admin, pages: row.pages ?? [] };
      return (
        row.email?.trim() &&
        (canManageBoards(access) || slugs.some((slug) => canViewBoard(access, slug)))
      );
    })
    .map((row) => ({
      email: row.email!.trim().toLowerCase(),
      name: row.display_name?.trim() || row.email!.trim().toLowerCase(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Explicit @email mentions; ordinary email addresses are not mentions. */
export function mentionedEmails(note: string, people: MentionPerson[]): string[] {
  const allowed = new Set(people.map((person) => person.email));
  const found = new Set<string>();
  for (const match of note.matchAll(
    /(?:^|[\s([{])@([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?=$|[\s.,!?;:)\]}])/gi
  )) {
    const email = match[1].toLowerCase();
    if (allowed.has(email)) found.add(email);
  }
  return [...found];
}

export function mentionQuery(note: string, caret: number) {
  const match = /(?:^|\s)@([^\s]*)$/.exec(note.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1].toLowerCase() } : null;
}
