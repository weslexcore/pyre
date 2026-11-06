import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definitionSchema, type JourneyRecord } from './schema';

// enrollFromEvent / enrollFromPurchase: a Momence event hands a member to a
// journey and the journey either enrolls them or writes down why not
// (journey_step_events, kind not-enrolled). Momence and Supabase are faked.

const inserts: Record<string, Record<string, unknown>[]> = {};
const results: Record<string, { data: unknown; error: unknown }> = {};
let dbAvailable = true;

/** A supabase-js stand-in: every call chains, awaiting yields the result for table.op. */
function fakeTable(table: string) {
  let op = 'select';
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          const result = results[`${table}.${op}`] ?? { data: null, error: null };
          return (resolve: (value: unknown) => void) => resolve(result);
        }
        return (...args: unknown[]) => {
          if (prop === 'insert') {
            op = 'insert';
            inserts[table] ??= [];
            inserts[table].push(args[0] as Record<string, unknown>);
          }
          return chain;
        };
      },
    }
  );
  return chain;
}

const loadJourneys = vi.fn<() => Promise<JourneyRecord[]>>();
const isAllowed = vi.fn<(email: string) => boolean>();
const fetchHostMember = vi.fn();
const isMemberFirstBooking = vi.fn();

vi.mock('@pyre/webhook-core', () => ({
  createWebhookLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getRedis: () => null,
}));
vi.mock('@/lib/analytics/posthog', () => ({ captureEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/db', () => ({
  getDb: () => (dbAvailable ? { from: fakeTable } : null),
}));
vi.mock('@/lib/email/dev-mode', () => ({
  getEmailGate: async () => ({ isAllowed, isLive: () => true, overrides: {} }),
}));
vi.mock('@/lib/email/send', () => ({ sendTemplate: vi.fn() }));
vi.mock('@/lib/momence/host-api', () => ({
  assignMemberTag: vi.fn(),
  fetchHostMember: (...args: unknown[]) => fetchHostMember(...args),
  fetchMembersFiltered: vi.fn(),
  fetchMemberActivePacks: vi.fn(async () => []),
  fetchMemberBoughtMemberships: vi.fn(async () => []),
  fetchSessionBookings: vi.fn(async () => []),
  findMemberByEmail: vi.fn(),
  getIntroOfferMembershipIds: vi.fn(async () => []),
  getTagIdByName: vi.fn(),
  removeMemberTag: vi.fn(),
}));
vi.mock('@/lib/momence/members', () => ({
  isMemberFirstBooking: (...args: unknown[]) => isMemberFirstBooking(...args),
}));
vi.mock('./store', () => ({ loadJourneys: () => loadJourneys() }));

const { enrollFromEvent } = await import('./engine');

function journey(
  id: string,
  trigger: Record<string, unknown>,
  extra: Partial<JourneyRecord> & { enrollIf?: unknown[] } = {}
): JourneyRecord {
  const { enrollIf = [], ...rest } = extra;
  return {
    id,
    name: id,
    enabled: true,
    testMode: false,
    archived: false,
    revision: 1,
    updatedAt: '2026-11-06T00:00:00Z',
    updatedBy: null,
    definition: definitionSchema.parse({
      trigger,
      enrollIf,
      steps: [
        { key: 'hello', timing: { anchor: 'previous', offsetHours: 1 }, content: { type: 'none' } },
      ],
    }),
    ...rest,
  };
}

const forest = {
  memberId: 31433182,
  email: 'Forrest@Example.com',
  firstName: 'Forest',
  lastName: 'Schmidt',
};

const purchase = {
  type: 'purchase' as const,
  ...forest,
  saleId: 1,
  itemType: 'membership',
  itemName: 'Unlimited Intro',
  saleItemId: 2,
  unitPrice: '79.00',
  kind: 'intro_offer' as const,
};

const booking = {
  type: 'session-booked' as const,
  ...forest,
  sessionId: 10,
  sessionBookingId: 11,
};

function notEnrolledRows() {
  return (inserts.journey_step_events ?? []).filter((r) => r.kind === 'not-enrolled');
}

beforeEach(() => {
  for (const key of Object.keys(inserts)) delete inserts[key];
  for (const key of Object.keys(results)) delete results[key];
  dbAvailable = true;
  isAllowed.mockReset().mockReturnValue(true);
  fetchHostMember.mockReset().mockResolvedValue({ id: forest.memberId, customerTags: [] });
  isMemberFirstBooking.mockReset();
  loadJourneys.mockReset();
});

describe('enrollFromPurchase', () => {
  it('writes a not-enrolled row naming the entry condition that did not hold', async () => {
    loadJourneys.mockResolvedValue([
      journey(
        'intro-to-membership',
        { type: 'purchased', kinds: ['intro_offer'] },
        { enrollIf: [{ type: 'has-tag', tag: 'vip' }] }
      ),
    ]);

    await enrollFromEvent(purchase);

    expect(inserts.journey_enrollments).toBeUndefined();
    expect(notEnrolledRows()).toEqual([
      {
        enrollment_id: null,
        journey_id: 'intro-to-membership',
        member_id: forest.memberId,
        email: 'forrest@example.com',
        step_key: null,
        kind: 'not-enrolled',
        detail: 'enroll-if:has-tag',
      },
    ]);
  });

  it('marks a negated condition with not-', async () => {
    fetchHostMember.mockResolvedValue({
      id: forest.memberId,
      customerTags: [{ name: 'staff' }],
    });
    loadJourneys.mockResolvedValue([
      journey(
        'j',
        { type: 'purchased' },
        { enrollIf: [{ type: 'has-tag', tag: 'staff', negate: true }] }
      ),
    ]);

    await enrollFromEvent(purchase);

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['enroll-if:not-has-tag']);
  });

  it('records a test-mode refusal for an address off the whitelist', async () => {
    isAllowed.mockReturnValue(false);
    loadJourneys.mockResolvedValue([journey('j', { type: 'purchased' }, { testMode: true })]);

    await enrollFromEvent(purchase);

    expect(fetchHostMember).not.toHaveBeenCalled();
    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['not-whitelisted']);
  });

  it('records someone already in the journey', async () => {
    results['journey_enrollments.select'] = {
      data: { status: 'active', cycle: 0, ended_at: null, updated_at: '2026-11-01T00:00:00Z' },
      error: null,
    };
    loadJourneys.mockResolvedValue([journey('j', { type: 'purchased' })]);

    await enrollFromEvent(purchase);

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['already-enrolled']);
  });

  it('records a check that threw, and still warns instead of failing the trigger', async () => {
    fetchHostMember.mockRejectedValue(new Error('Momence 503'));
    loadJourneys.mockResolvedValue([
      journey('j', { type: 'purchased' }, { enrollIf: [{ type: 'has-tag', tag: 'vip' }] }),
    ]);

    await expect(enrollFromEvent(purchase)).resolves.toBeUndefined();

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['check-failed:Momence 503']);
  });

  it('writes nothing but the enrollment when they get in', async () => {
    results['journey_enrollments.insert'] = { data: { id: 'e1' }, error: null };
    loadJourneys.mockResolvedValue([journey('j', { type: 'purchased' })]);

    await enrollFromEvent(purchase);

    expect(inserts.journey_enrollments).toHaveLength(1);
    expect(notEnrolledRows()).toEqual([]);
    expect(inserts.journey_step_events?.map((r) => r.kind)).toEqual(['enrolled']);
  });

  it('never fails the trigger when the log write itself fails', async () => {
    results['journey_step_events.insert'] = { data: null, error: { message: 'down' } };
    loadJourneys.mockResolvedValue([
      journey('j', { type: 'purchased' }, { enrollIf: [{ type: 'has-tag', tag: 'vip' }] }),
    ]);

    await expect(enrollFromEvent(purchase)).resolves.toBeUndefined();
  });
});

describe('enrollFromEvent (session booked)', () => {
  it('records a repeat booking on a first-booking-only journey', async () => {
    isMemberFirstBooking.mockResolvedValue(false);
    loadJourneys.mockResolvedValue([
      journey('post-first-visit', { type: 'session-booked', firstBookingOnly: true }),
    ]);

    await enrollFromEvent(booking);

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['not-first-booking']);
  });

  it('treats an unknown booking history as not the first booking', async () => {
    isMemberFirstBooking.mockResolvedValue(null);
    loadJourneys.mockResolvedValue([
      journey('post-first-visit', { type: 'session-booked', firstBookingOnly: true }),
    ]);

    await enrollFromEvent(booking);

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['not-first-booking']);
  });

  it('records a failed entry condition on a booking journey too', async () => {
    loadJourneys.mockResolvedValue([
      journey('j', { type: 'session-booked' }, { enrollIf: [{ type: 'has-tag', tag: 'vip' }] }),
    ]);

    await enrollFromEvent(booking);

    expect(notEnrolledRows().map((r) => r.detail)).toEqual(['enroll-if:has-tag']);
  });
});
