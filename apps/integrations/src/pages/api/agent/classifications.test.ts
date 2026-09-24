// The classifier's one write path: results land only on the row whose
// request id the session carries, only while that request is current, and
// only as signals the shared registry accepts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClassificationsDb } from '@/lib/classify/fake-db.test-helper';

const isAgentAuthorized = vi.fn();
const getDb = vi.fn();
vi.mock('@/lib/agent/auth', () => ({
  isAgentAuthorized: (r: unknown) => isAgentAuthorized(r),
  agentUnauthorizedResponse: () => new Response('{}', { status: 401 }),
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const { POST } = await import('./classifications');

const REQUEST = '22222222-2222-4222-8222-222222222222';

function post(body: unknown) {
  return POST({
    request: new Request('https://integrations.test/api/agent/classifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  } as never);
}

describe('POST /api/agent/classifications', () => {
  let fake: ReturnType<typeof fakeClassificationsDb>;

  beforeEach(() => {
    isAgentAuthorized.mockReturnValue(true);
    fake = fakeClassificationsDb([
      {
        id: 'row-1',
        subject_type: 'shift_note',
        subject_id: '33333333-3333-4333-8333-333333333333',
        status: 'pending',
        signals: [],
        request_id: REQUEST,
      },
    ]);
    getDb.mockReturnValue(fake.db);
  });

  it('rejects callers without the agent secret', async () => {
    isAgentAuthorized.mockReturnValue(false);
    expect((await post({ requestId: REQUEST, signals: [] })).status).toBe(401);
  });

  it('saves validated signals on the request’s row', async () => {
    const res = await post({
      requestId: REQUEST.toUpperCase(),
      signals: [{ type: 'action', summary: '  Order   towels ' }],
      agentSessionId: 'sess_1',
    });
    expect(res.status).toBe(200);
    expect(fake.rows[0]).toMatchObject({
      status: 'done',
      signals: [{ type: 'action', summary: 'Order towels' }],
      agent_session_id: 'sess_1',
    });
  });

  it('turns away unknown signal types so the agent can fix them', async () => {
    const res = await post({ requestId: REQUEST, signals: [{ type: 'gossip', summary: 'x' }] });
    expect(res.status).toBe(400);
    expect(fake.rows[0]?.status).toBe('pending');
  });

  it('refuses a superseded request', async () => {
    const res = await post({
      requestId: '44444444-4444-4444-8444-444444444444',
      signals: [],
    });
    expect(res.status).toBe(409);
    expect(fake.rows[0]?.status).toBe('pending');
  });

  it('rejects a malformed request id', async () => {
    expect((await post({ requestId: 'nope', signals: [] })).status).toBe(400);
  });
});
