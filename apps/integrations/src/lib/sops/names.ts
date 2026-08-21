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
