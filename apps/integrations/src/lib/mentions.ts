// @-mentions, wherever people talk to each other in the dashboard: admin
// messages and their replies, shift notes and their replies, card and goal
// comments, the follow-up notes on an incident. A mention is written into
// the text as `@<email>` — the stable identity every other record uses — and
// drawn back as the person's roster name (components/admin/Mentions). Whoever
// is named gets a bell notification (lib/notifications/mentions).
//
// Who may be named follows who can see the conversation: the server computes
// the candidates for a subject (a message's audience, a note's readers, a
// board's holders) and hands the same list to the composer for autocomplete,
// so nobody is ever pointed at a page they can't open. Client-bundle-safe:
// pure text functions and roster filters, no db or env imports.

import { canViewPage } from '@/components/admin/adminTools';
import type { StaffRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { accessOf, type RosterRow } from '@/lib/notifications/recipients';
import { canUseDashboard } from '@/lib/sops/levels';
import type { PeopleNames } from '@/lib/sops/names';

export interface MentionPerson {
  email: string;
  name: string;
}

/** A candidate with their admin flag, for rules that keep some threads among the admins. */
export interface MentionCandidate extends MentionPerson {
  isAdmin: boolean;
}

/** The local part and domain of an address as the mention syntax accepts them. */
const EMAIL = "[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?";

/**
 * An explicit `@email` token: at the start of the text or after whitespace or
 * an opening bracket, ended by the text, whitespace, or closing punctuation.
 * A bare address ("mail a@b.c") is not a mention. Group 1 is the address.
 */
const MENTION_RE = new RegExp(`(?:^|[\\s([{])@(${EMAIL})(?=$|[\\s.,!?;:)\\]}])`, 'gi');

/** Where a mention's `@` sits in a match (the opening boundary is consumed). */
function tokenStart(match: RegExpMatchArray): number {
  return (match.index ?? 0) + match[0].length - match[1].length - 1;
}

/**
 * Roster rows that may be named, by a visibility test over the row — sorted
 * by name, with an email. Scheduling availability (`active`) is not the
 * test; being able to open the conversation is.
 */
export function mentionCandidates<
  Row extends Pick<StaffRow, 'email' | 'display_name' | 'is_admin'>,
>(rows: Row[], canSee: (row: Row) => boolean): MentionCandidate[] {
  return rows
    .filter((row) => normalizeEmail(row.email) && canSee(row))
    .map((row) => {
      const email = normalizeEmail(row.email);
      return { email, name: (row.display_name ?? '').trim() || email, isAdmin: row.is_admin };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Everyone who can open an admin page — the readers of a shared shift note,
 * say. Dashboard users only: a roster-only person has no inbox to ping.
 */
export function pageMentionCandidates(rows: RosterRow[], href: string): MentionCandidate[] {
  return mentionCandidates(rows, (row) => canUseDashboard(row) && canViewPage(accessOf(row), href));
}

/** Explicit mentions of people in `people`; lowercased, each once, in writing order. */
export function mentionedEmails(text: string, people: readonly MentionPerson[]): string[] {
  const allowed = new Set(people.map((person) => person.email));
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const email = match[1].toLowerCase();
    if (allowed.has(email)) found.add(email);
  }
  return [...found];
}

/**
 * Every address written as a mention, whoever it names — for building the
 * name directory a response carries, so each one can be drawn as a name.
 */
export function mentionedAddresses(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((match) => match[1].toLowerCase()))];
}

/** The people an edit newly names: mentioned in `after`, not in `before`. */
export function newMentions(
  before: string,
  after: string,
  people: readonly MentionPerson[]
): string[] {
  const had = new Set(mentionedEmails(before, people));
  return mentionedEmails(after, people).filter((email) => !had.has(email));
}

/** The `@` query under the caret, or null when the caret isn't in one. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1].toLowerCase() } : null;
}

/** The candidates matching what has been typed after the `@`, at most `limit`. */
export function matchMentions<P extends MentionPerson>(
  people: readonly P[],
  query: string,
  limit = 8
): P[] {
  const q = query.toLowerCase();
  return people
    .filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(q))
    .slice(0, limit);
}

/** What picking a person writes into the text, with the space that ends the token. */
export function mentionToken(person: MentionPerson): string {
  return `@${person.email} `;
}

/** A names map from a candidate list, for drawing mentions before the server has answered. */
export function namesOf(people: readonly MentionPerson[]): PeopleNames {
  return Object.fromEntries(people.map((person) => [person.email, person.name]));
}

/** One run of a text: plain words, or a mention of a known person. */
export interface MentionSegment {
  text: string;
  mention?: { email: string; name: string };
}

/**
 * The text cut at its mentions of people in `names`, so a plain-text view
 * can draw each one as a name. Addresses the names don't know stay as typed.
 */
export function mentionSegments(text: string, names: PeopleNames): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const email = match[1].toLowerCase();
    const name = names[email];
    if (!name) continue;
    const start = tokenStart(match);
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: `@${match[1]}`, mention: { email, name } });
    cursor = start + match[1].length + 1;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** Mentions of known people read as "@Name" — for a notification's one-line excerpt. */
export function mentionsAsNames(text: string, names: PeopleNames): string {
  return mentionSegments(text, names)
    .map((segment) => (segment.mention ? `@${segment.mention.name}` : segment.text))
    .join('');
}

/** The fragment a rendered mention links to; the address follows it. */
export const MENTION_HREF_PREFIX = '#mention-';

/** The address a rendered mention's href names, or null for any other link. */
export function mentionFromHref(href: string | null | undefined): string | null {
  return href?.startsWith(MENTION_HREF_PREFIX) ? href.slice(MENTION_HREF_PREFIX.length) : null;
}

/** Code spans and fences, inside which nothing is a mention. */
const CODE_RE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/**
 * Markdown with each mention of a known person rewritten as a link the
 * renderer draws as a name chip (`[@Name](#mention-<email>)`). Left as
 * `@email`, GFM would autolink the address as mailto and show it raw.
 */
export function markdownWithMentions(markdown: string, names: PeopleNames): string {
  if (!markdown.includes('@')) return markdown;
  return markdown
    .split(CODE_RE)
    .map((piece, index) =>
      // Odd pieces are the code the split captured; leave them alone.
      index % 2 === 1
        ? piece
        : mentionSegments(piece, names)
            .map((segment) =>
              segment.mention
                ? `[@${segment.mention.name}](${MENTION_HREF_PREFIX}${segment.mention.email})`
                : segment.text
            )
            .join('')
    )
    .join('');
}
