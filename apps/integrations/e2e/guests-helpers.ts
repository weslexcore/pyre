// Helpers shared by the guests specs: a Momence member and booking of the
// test's own. Ids come from the mock, unique per run (momence-world.ts).

import type { TestInfo } from '@playwright/test';
import { momence } from './momence';

export interface TestGuest {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
}

/** A Momence member with a name no other test uses (searchable on its own). */
export async function addGuest(testInfo: TestInfo, firstName = 'Rowan'): Promise<TestGuest> {
  const nonce = Math.random().toString(36).slice(2, 8);
  const lastName = `Guest${nonce}`;
  const email = `guest-${testInfo.project.name}-${nonce}@e2e.test`.toLowerCase();
  const { id } = await momence.addMember({ firstName, lastName, email });
  return { id, firstName, lastName, name: `${firstName} ${lastName}`, email };
}

/** A booking for this guest on one session. */
export const addBooking = (booking: { sessionId: number; memberId: number }) =>
  momence.addBooking(booking);
