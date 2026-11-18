// Add Momence data for one test: members, sessions and bookings in the mock
// server's in-memory Momence (mock-server/momence-world.ts). Ids come back
// from the mock, so tests running in parallel never share an entity.

import { MOCK_URL } from './ports';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MOCK_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Mock Momence ${path} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export interface MemberInput {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
}

export interface SessionInput {
  name: string;
  /** ISO timestamps. */
  startsAt: string;
  endsAt: string;
  capacity?: number;
}

export const momence = {
  addMember: (member: MemberInput) => post<{ id: number }>('/__momence/members', member),
  addSession: (session: SessionInput) => post<{ id: number }>('/__momence/sessions', session),
  addBooking: (booking: { sessionId: number; memberId: number }) =>
    post<{ id: number }>('/__momence/bookings', booking),
  /** Booking ids the app has checked in at Momence. */
  checkIns: async (): Promise<number[]> => {
    const res = await fetch(`${MOCK_URL}/__momence/check-ins`);
    return (await res.json()) as number[];
  },
};

/** A session starting `minutesFromNow` (negative = already started), `lengthMinutes` long. */
export function sessionAround(minutesFromNow: number, lengthMinutes = 90) {
  const startsAt = new Date(Date.now() + minutesFromNow * 60_000);
  return {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + lengthMinutes * 60_000).toISOString(),
  };
}
