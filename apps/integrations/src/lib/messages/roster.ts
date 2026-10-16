// Request-body audiences checked against the staff roster, shared by the
// message and message-template routes. Server-only (reads the roster).

import type { AdminMessageRow } from '@/lib/db';
import { listGrantablePeople } from '@/lib/sops/people';
import { parseAudience } from './validate';

/** The audience a request names, with every named email on the roster. */
export async function checkedAudience(
  roles: unknown,
  emails: unknown
): Promise<{ roles: AdminMessageRow['audience_roles']; emails: string[] } | { error: string }> {
  const parsed = parseAudience(roles, emails);
  if (!parsed.ok) return { error: parsed.error };
  const roster = new Set((await listGrantablePeople()).map((person) => person.email));
  const unknown = parsed.audience.emails.filter((email) => !roster.has(email));
  if (unknown.length > 0) {
    return { error: `audienceEmails names people not on the roster: ${unknown.join(', ')}` };
  }
  return parsed.audience;
}
