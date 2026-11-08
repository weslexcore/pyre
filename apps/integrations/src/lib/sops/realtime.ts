// The Realtime side of checklist runs (see the sop_runs_realtime migration).
// One private channel per document, `sop:<id>`, carries two things: the
// database's broadcasts whenever the document's run or its checks change,
// and the Presence of the people who have the checklist open — who they
// are and which item they last touched. A second channel, `sops:runs`, gets
// one message per run-level change for the log and the library strip.
// Pure and client-bundle-safe; the hooks live in lib/client.

import { normalizeEmail } from '@/lib/email/address';

export const SOP_CHANGED_EVENT = 'changed';
export const SOP_RUNS_TOPIC = 'sops:runs';

export function sopTopic(sopId: string): string {
  return `sop:${sopId}`;
}

/** What each person on a checklist announces about themselves. */
export interface SopPresence {
  email: string;
  name: string;
  /** The item they last resolved or un-resolved on this screen; null until they tap. */
  item: number | null;
  /** ISO time of that tap (or of opening the page). */
  at: string;
}

/**
 * Everyone else on the channel, one entry per person, from Realtime's raw
 * presence state (one list per connection — a person with two tabs open is
 * there twice; the most recent entry wins). The viewer is left out: they
 * know where they are.
 */
export function collectOthers(
  state: Record<string, (Partial<SopPresence> & { presence_ref?: string })[]>,
  viewerEmail: string
): SopPresence[] {
  const me = normalizeEmail(viewerEmail);
  const byEmail = new Map<string, SopPresence>();
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const email = normalizeEmail(entry.email);
      if (!email || email === me) continue;
      const candidate: SopPresence = {
        email,
        name: entry.name?.trim() || email.slice(0, email.indexOf('@')),
        item: typeof entry.item === 'number' ? entry.item : null,
        at: typeof entry.at === 'string' ? entry.at : '',
      };
      const held = byEmail.get(email);
      if (!held || candidate.at > held.at) byEmail.set(email, candidate);
    }
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The names at each item index, for the row markers ("Sam is here"). */
export function presenceByItem(others: SopPresence[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const person of others) {
    if (person.item === null) continue;
    const names = map.get(person.item) ?? [];
    names.push(person.name);
    map.set(person.item, names);
  }
  return map;
}
