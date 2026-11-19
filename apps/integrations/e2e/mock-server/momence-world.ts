// An in-memory Momence for the mock server: members, sessions and bookings
// that specs add through a control API, so the app's host-API calls answer
// with data a test chose. Every entity gets an id from here, so tests running
// in parallel never collide; each one reads back only what it added.
//
// Control API (driven by e2e/momence.ts):
//   POST /__momence/members    { firstName, lastName, email, ... } -> { id }
//   GET  /__momence/members/{id}                                    -> the member, with tag names
//   POST /__momence/sessions   { name, startsAt, endsAt, ... }      -> { id }
//   POST /__momence/bookings   { sessionId, memberId, ... }         -> { id }
//   POST /__momence/tags       { name }                             -> { id } (existing id if named)
//   GET  /__momence/check-ins                                       -> booking ids checked in
//
// Host API served from that state (paths under /momence/api/v2). Every call
// must carry the access token the mock's /auth/token issued, and anything not
// listed here is unexpected (server.ts answers 404 and records it):
//   GET    /host/members/{id}                      the member, or 404
//   POST   /host/members                           create one { email, firstName, lastName }
//   POST   /host/members/list                      members matching body.query / tag filter
//   GET    /host/members/{id}/sessions             the member's bookings
//   GET    /host/members/{id}/bought-memberships[/active]   none: nobody here owns a pack
//   PUT    /host/members/{id}/phone-number         { phoneNumber }
//   POST   /host/members/{id}/tags/{tagId}         tag them (404 for an unknown member or tag)
//   DELETE /host/members/{id}/tags/{tagId}         untag them
//   GET    /host/tags                              tags added through the control API
//   GET    /host/sessions?startAfter&startBefore   sessions starting in the window
//   GET    /host/sessions/{id}/bookings            that session's bookings
//   POST   /host/session-bookings/{id}/check-in    marks the booking checked in
//   DELETE /host/session-bookings/{id}/check-in    clears it
//   GET    /host/appointments/reservations         none: the studio books no appointments

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

/** The token /auth/token hands out; host calls without it get a 401. */
export const ACCESS_TOKEN = 'e2e-access';

/** Momence's paginated list shape, honouring ?page and ?pageSize. */
const page = <T>(items: T[], query?: URLSearchParams) => {
  const pageNo = Number(query?.get('page') ?? 0) || 0;
  const pageSize = Number(query?.get('pageSize') ?? 100) || 100;
  return {
    json: {
      payload: items.slice(pageNo * pageSize, (pageNo + 1) * pageSize),
      pagination: { page: pageNo, pageSize, totalCount: items.length },
    },
  };
};

const badRequest = (message: string): MockResponse => ({ status: 400, json: { message } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const tags = new Map<number, string>();
  /** Tag ids per member. */
  const memberTags = new Map<number, Set<number>>();

  const newMember = (input: Omit<WorldMember, 'id'>): number => {
    const id = nextId++;
    members.set(id, {
      phoneNumber: null,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      customerFields: [],
      ...input,
      visits: {
        total: 0,
        totalVisits: 0,
        bookings: 0,
        bookingsVisits: 0,
        appointments: 0,
        appointmentsVisits: 0,
        openAreaVisits: 0,
        ...input.visits,
      },
      id,
    });
    return id;
  };

  /** A member as the host API returns them: their tags as { id, name }. */
  const hostMember = (member: WorldMember) => ({
    ...member,
    customerTags: [...(memberTags.get(member.id) ?? [])].map((id) => ({
      id,
      name: tags.get(id),
    })),
  });

  const idFromPath = (path: string, pattern: RegExp) => Number(path.match(pattern)?.[1]);

  const control: MockRoute[] = [
    {
      method: 'POST',
      path: '/__momence/members',
      handler: ({ body }) => ({ json: { id: newMember(body as Omit<WorldMember, 'id'>) } }),
    },
    {
      path: /^\/__momence\/members\/(\d+)$/,
      handler: ({ path }): MockResponse => {
        const member = members.get(idFromPath(path, /members\/(\d+)$/));
        if (!member) return { status: 404, json: { message: 'Member not found' } };
        const view = hostMember(member);
        return { json: { ...view, tags: view.customerTags.map((t) => t.name) } };
      },
    },
    {
      method: 'POST',
      path: '/__momence/tags',
      handler: ({ body }) => {
        const name = String((body as { name?: string })?.name ?? '').trim();
        if (!name) return badRequest('name is required');
        for (const [id, existing] of tags) {
          if (existing.toLowerCase() === name.toLowerCase()) return { json: { id } };
        }
        const id = nextId++;
        tags.set(id, name);
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
        const input = (body ?? {}) as {
          query?: string;
          page?: number;
          pageSize?: number;
          filter?: { customerTags?: { tags?: number[]; customerHaveTag?: string } };
        };
        if (typeof input.page !== 'number' || typeof input.pageSize !== 'number') {
          return badRequest('page and pageSize are required');
        }
        const query = String(input.query ?? '')
          .trim()
          .toLowerCase();
        const tagFilter = input.filter?.customerTags?.tags;
        const all = [...members.values()].filter(
          (m) =>
            (!query ||
              [m.firstName, m.lastName, `${m.firstName} ${m.lastName}`, m.email].some((value) =>
                value.toLowerCase().includes(query)
              )) &&
            (!tagFilter || tagFilter.some((tagId) => memberTags.get(m.id)?.has(tagId)))
        );
        const params = new URLSearchParams({
          page: String(input.page),
          pageSize: String(input.pageSize),
        });
        return page(all.map(hostMember), params);
      },
    },
    {
      method: 'POST',
      path: `${V2}/host/members`,
      handler: ({ body }): MockResponse => {
        const { email, firstName, lastName, phoneNumber } = (body ?? {}) as Record<string, string>;
        if (!EMAIL_RE.test(email ?? '')) return badRequest('email is invalid');
        if (!firstName?.trim() || !lastName?.trim()) return badRequest('name is required');
        if ([...members.values()].some((m) => m.email.toLowerCase() === email.toLowerCase())) {
          return { status: 409, json: { message: 'Member with this email already exists' } };
        }
        return { json: { memberId: newMember({ email, firstName, lastName, phoneNumber }) } };
      },
    },
    {
      path: new RegExp(`^${V2}/host/members/(\\d+)$`),
      handler: ({ path }): MockResponse => {
        const member = members.get(idFromPath(path, /members\/(\d+)$/));
        return member
          ? { json: hostMember(member) }
          : { status: 404, json: { message: 'Member not found' } };
      },
    },
    {
      path: new RegExp(`^${V2}/host/members/(\\d+)/sessions$`),
      handler: ({ path, query }): MockResponse => {
        const memberId = idFromPath(path, /members\/(\d+)\/sessions$/);
        if (!members.has(memberId)) return { status: 404, json: { message: 'Member not found' } };
        const includeCancelled = query.get('includeCancelled') === 'true';
        return page(
          [...bookings.values()].filter(
            (b) => b.member.id === memberId && (includeCancelled || !b.cancelledAt)
          ),
          query
        );
      },
    },
    {
      path: new RegExp(`^${V2}/host/members/(\\d+)/bought-memberships(/active)?$`),
      handler: ({ path, query }): MockResponse => {
        const memberId = idFromPath(path, /members\/(\d+)\/bought/);
        if (!members.has(memberId)) return { status: 404, json: { message: 'Member not found' } };
        return page([], query);
      },
    },
    {
      method: 'PUT',
      path: new RegExp(`^${V2}/host/members/(\\d+)/phone-number$`),
      handler: ({ path, body }): MockResponse => {
        const member = members.get(idFromPath(path, /members\/(\d+)\/phone/));
        if (!member) return { status: 404, json: { message: 'Member not found' } };
        const phoneNumber = (body as { phoneNumber?: string })?.phoneNumber;
        if (!phoneNumber || !/^\+?\d{10,15}$/.test(phoneNumber)) {
          return badRequest('phoneNumber is invalid');
        }
        member.phoneNumber = phoneNumber;
        return { status: 204 };
      },
    },
    ...(['POST', 'DELETE'] as const).map(
      (method): MockRoute => ({
        method,
        path: new RegExp(`^${V2}/host/members/(\\d+)/tags/(\\d+)$`),
        handler: ({ path }): MockResponse => {
          const [, memberId, tagId] = (path.match(/members\/(\d+)\/tags\/(\d+)$/) ?? []).map(
            Number
          );
          if (!members.has(memberId)) return { status: 404, json: { message: 'Member not found' } };
          if (!tags.has(tagId)) return { status: 404, json: { message: 'Tag not found' } };
          const held = memberTags.get(memberId) ?? new Set<number>();
          if (method === 'POST') held.add(tagId);
          else held.delete(tagId);
          memberTags.set(memberId, held);
          return { status: 204 };
        },
      })
    ),
    {
      path: `${V2}/host/tags`,
      handler: ({ query }) =>
        page(
          [...tags].map(([id, name]) => ({ id, name })),
          query
        ),
    },
    {
      path: `${V2}/host/appointments/reservations`,
      handler: ({ query }) => page([], query),
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

  // Host calls must be authorised the way Momence wants: the bearer token.
  const authorised = host.map(
    (route): MockRoute => ({
      ...route,
      handler: (request) =>
        request.headers.authorization === `Bearer ${ACCESS_TOKEN}`
          ? route.handler(request)
          : { status: 401, json: { message: 'Missing or invalid access token' } },
    })
  );

  return [...control, ...authorised];
}
