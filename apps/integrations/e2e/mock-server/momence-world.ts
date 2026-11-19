// An in-memory Momence for the mock server: members, sessions and bookings
// that specs add through a control API, so the app's host-API calls answer
// with data a test chose. Every entity gets an id from here, so tests running
// in parallel never collide; each one reads back only what it added.
//
// Control API (driven by e2e/momence.ts):
//   POST /__momence/members    { firstName, lastName, email, ... } -> { id }
//   POST /__momence/sessions   { name, startsAt, endsAt, ... }      -> { id }
//   POST /__momence/bookings   { sessionId, memberId, ... }         -> { id }
//   GET  /__momence/check-ins                                       -> booking ids checked in
//
// Host API served from that state (paths under /momence/api/v2):
//   GET    /host/members/{id}                      the member, or 404
//   POST   /host/members/list                      members matching body.query
//   GET    /host/sessions?startAfter&startBefore   sessions starting in the window
//   GET    /host/sessions/{id}/bookings            that session's bookings
//   POST   /host/session-bookings/{id}/check-in    marks the booking checked in
//   DELETE /host/session-bookings/{id}/check-in    clears it

import type { MockRequest, MockResponse, MockRoute } from '@pyre/e2e-utils/server';

export interface WorldMember {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string | null;
  firstSeen?: string;
  lastSeen?: string;
  visits?: Record<string, number>;
  customerFields?: unknown[];
  customerTags?: unknown[];
}

export interface WorldSession {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  bookingCount?: number;
  isDraft?: boolean;
  isCancelled?: boolean;
}

export interface WorldBooking {
  id: number;
  sessionId: number;
  checkedIn: boolean;
  ticketsBought?: number;
  cancelledAt?: string | null;
  member: { id: number; email: string; firstName: string; lastName: string };
}

const V2 = '/momence/api/v2';

const page = <T>(items: T[]) => ({
  json: { payload: items, pagination: { page: 0, pageSize: 100, totalCount: items.length } },
});

export function momenceWorld(): MockRoute[] {
  // Ids never look like a real Momence id (7 billion and up), and each start
  // of the mock takes its own block of them: the database keeps what earlier
  // runs filed under an id, so a reused id would inherit old profiles and
  // check-ins. A block per second of the clock repeats only after ~11 days.
  let nextId = 7_000_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 1000;
  const members = new Map<number, WorldMember>();
  const sessions = new Map<number, WorldSession>();
  const bookings = new Map<number, WorldBooking>();
  const checkIns = new Set<number>();

  const idFromPath = (path: string, pattern: RegExp) => Number(path.match(pattern)?.[1]);

  const control: MockRoute[] = [
    {
      method: 'POST',
      path: '/__momence/members',
      handler: ({ body }) => {
        const input = body as Omit<WorldMember, 'id'>;
        const id = nextId++;
        members.set(id, {
          phoneNumber: null,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          visits: { total: 0, totalVisits: 0, bookings: 0, bookingsVisits: 0 },
          customerFields: [],
          customerTags: [],
          ...input,
          id,
        });
        return { json: { id } };
      },
    },
    {
      method: 'POST',
      path: '/__momence/sessions',
      handler: ({ body }) => {
        const id = nextId++;
        sessions.set(id, {
          capacity: 12,
          bookingCount: 0,
          isDraft: false,
          isCancelled: false,
          ...(body as Omit<WorldSession, 'id'>),
          id,
        });
        return { json: { id } };
      },
    },
    {
      method: 'POST',
      path: '/__momence/bookings',
      handler: ({ body }) => {
        const { sessionId, memberId, ...rest } = body as {
          sessionId: number;
          memberId: number;
        } & Partial<WorldBooking>;
        const member = members.get(memberId);
        const session = sessions.get(sessionId);
        if (!member || !session)
          return { status: 400, json: { error: 'unknown member or session' } };
        const id = nextId++;
        bookings.set(id, {
          checkedIn: false,
          ticketsBought: 1,
          cancelledAt: null,
          ...rest,
          id,
          sessionId,
          member: {
            id: member.id,
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
          },
        });
        session.bookingCount = (session.bookingCount ?? 0) + 1;
        return { json: { id } };
      },
    },
    { path: '/__momence/check-ins', handler: () => ({ json: [...checkIns] }) },
  ];

  const host: MockRoute[] = [
    {
      method: 'POST',
      path: `${V2}/host/members/list`,
      handler: ({ body }) => {
        const query = String((body as { query?: string })?.query ?? '')
          .trim()
          .toLowerCase();
        const all = [...members.values()];
        return page(
          query
            ? all.filter((m) =>
                [m.firstName, m.lastName, `${m.firstName} ${m.lastName}`, m.email].some((value) =>
                  value.toLowerCase().includes(query)
                )
              )
            : all
        );
      },
    },
    {
      path: new RegExp(`^${V2}/host/members/(\\d+)$`),
      handler: ({ path }): MockResponse => {
        const member = members.get(idFromPath(path, /members\/(\d+)$/));
        return member ? { json: member } : { status: 404, json: { message: 'Member not found' } };
      },
    },
    {
      path: `${V2}/host/sessions`,
      handler: ({ query }: MockRequest) => {
        const after = Date.parse(query.get('startAfter') ?? '') || Number.NEGATIVE_INFINITY;
        const before = Date.parse(query.get('startBefore') ?? '') || Number.POSITIVE_INFINITY;
        return page(
          [...sessions.values()]
            .filter((s) => {
              const at = Date.parse(s.startsAt);
              return at >= after && at < before;
            })
            .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        );
      },
    },
    {
      path: new RegExp(`^${V2}/host/sessions/(\\d+)/bookings$`),
      handler: ({ path }) => {
        const sessionId = idFromPath(path, /sessions\/(\d+)\/bookings$/);
        return page(
          [...bookings.values()]
            .filter((b) => b.sessionId === sessionId)
            .map((b) => ({ ...b, checkedIn: checkIns.has(b.id) || b.checkedIn }))
        );
      },
    },
    {
      method: 'POST',
      path: new RegExp(`^${V2}/host/session-bookings/(\\d+)/check-in$`),
      handler: ({ path }) => {
        const id = idFromPath(path, /session-bookings\/(\d+)\/check-in$/);
        if (!bookings.has(id)) return { status: 404, json: { message: 'Booking not found' } };
        checkIns.add(id);
        return { json: { success: true } };
      },
    },
    {
      method: 'DELETE',
      path: new RegExp(`^${V2}/host/session-bookings/(\\d+)/check-in$`),
      handler: ({ path }) => {
        const id = idFromPath(path, /session-bookings\/(\d+)\/check-in$/);
        checkIns.delete(id);
        const booking = bookings.get(id);
        if (booking) booking.checkedIn = false;
        return { json: { success: true } };
      },
    },
  ];

  return [...control, ...host];
}
