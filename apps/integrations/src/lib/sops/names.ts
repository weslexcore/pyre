// How SOP actors read in the UI. Runs, checks and version history all record
// the session email (the stable identity), but staff read better by name, so
// every SOP response ships a name directory built from the staff roster (see
// people.ts, server-only) and the islands render through personName().

/** Lowercased email → display name, for everyone on the staff roster. */
export type PeopleNames = Record<string, string>;

/**
 * The roster name for an actor email, falling back to the email's local part
 * for anyone the roster doesn't know — a departed teammate, or a run started
 * before they were added.
 */
export function personName(email: string, people?: PeopleNames): string {
  const name = people?.[email.trim().toLowerCase()];
  if (name) return name;
  return email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
}

/**
 * Whether two actor emails name the same person. Runs record the session
 * email as it came in, so the comparison normalises both sides the way the
 * roster lookup does. Empty on either side is never a match — a signed-out
 * viewer owns nothing.
 */
export function sameActor(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? '').trim().toLowerCase();
  const right = (b ?? '').trim().toLowerCase();
  return left !== '' && left === right;
}

/**
 * How an actor reads to the viewer: "you" for the viewer themselves, the
 * roster name for anyone else. Used wherever a run says who started or
 * ended it, so a person's own runs stand out from the shared list.
 */
export function actorLabel(email: string, viewerEmail: string, people?: PeopleNames): string {
  return sameActor(email, viewerEmail) ? 'you' : personName(email, people);
}
