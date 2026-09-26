// Scheduling a classification must never hold the note's response: it only
// queues work (waitUntil). With QStash the work is one published job the
// worker picks up (retried by QStash); without it, or when QStash is down, the
// classification runs in this instance's background instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const waitUntil = vi.fn();
vi.mock('@vercel/functions', () => ({ waitUntil: (p: unknown) => waitUntil(p) }));

const publishJSON = vi.fn();
const batchJSON = vi.fn();
const ClientCtor = vi.fn();
vi.mock('@upstash/qstash', () => ({
  Client: class {
    constructor(opts: unknown) {
      ClientCtor(opts);
    }
    publishJSON = publishJSON;
    batchJSON = batchJSON;
  },
}));

const runClassification = vi.fn();
vi.mock('./request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./request')>()),
  runClassification: (...args: unknown[]) => runClassification(...args),
}));
const getDb = vi.fn(() => ({}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const {
  CLASSIFY_PARALLELISM,
  CLASSIFY_RETRIES,
  classifyRunUrl,
  dispatchClassification,
  dispatchClassifications,
  scheduleClassification,
} = await import('./dispatch');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

describe('scheduleClassification', () => {
  beforeEach(() => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-key');
    waitUntil.mockReset();
    publishJSON.mockReset();
    runClassification.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('hands the work to waitUntil and returns without doing any of it', () => {
    expect(scheduleClassification('shift_note', NOTE_ID, 'Towels low')).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise);
  });

  it('does nothing when Jev cannot be reached', () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    scheduleClassification('shift_note', NOTE_ID, 'Towels low');
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

describe('dispatchClassification', () => {
  beforeEach(() => {
    vi.stubEnv('QSTASH_TOKEN', 'qs_token');
    vi.stubEnv('CRON_SECRET', 'cron_secret');
    vi.stubEnv('PUBLIC_EMAIL_ASSET_BASE', 'https://integrations.pyre.test/assets');
    publishJSON.mockReset().mockResolvedValue({ messageId: 'msg_1' });
    ClientCtor.mockReset();
    runClassification.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('publishes one job to the worker, authenticated and retried by QStash', async () => {
    const outcome = await dispatchClassification('shift_note', NOTE_ID, 'Towels low');
    expect(outcome).toEqual({ via: 'qstash', messageId: 'msg_1' });
    expect(ClientCtor).toHaveBeenCalledWith({ token: 'qs_token' });
    expect(publishJSON.mock.calls[0]?.[0]).toEqual({
      url: 'https://integrations.pyre.test/api/classify/run',
      body: { subject: 'shift_note', id: NOTE_ID },
      retries: CLASSIFY_RETRIES,
      flowControl: { key: 'classify', parallelism: CLASSIFY_PARALLELISM },
      headers: { Authorization: 'Bearer cron_secret' },
    });
    expect(classifyRunUrl()).toBe('https://integrations.pyre.test/api/classify/run');
    expect(runClassification).not.toHaveBeenCalled();
  });

  it('carries force and the requesting admin for a re-run, and the preview bypass', async () => {
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'bypass');
    await dispatchClassification('shift_note', NOTE_ID, 'Towels low', {
      force: true,
      requestedBy: 'wes@pyresauna.com',
    });
    const message = publishJSON.mock.calls[0]?.[0] as {
      body: unknown;
      headers: Record<string, string>;
    };
    expect(message.body).toEqual({
      subject: 'shift_note',
      id: NOTE_ID,
      force: true,
      requestedBy: 'wes@pyresauna.com',
    });
    expect(message.headers['x-vercel-protection-bypass']).toBe('bypass');
  });

  it('runs inline when QStash is not configured', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    expect(await dispatchClassification('shift_note', NOTE_ID, 'Towels low')).toEqual({
      via: 'inline',
    });
    expect(publishJSON).not.toHaveBeenCalled();
    expect(runClassification).toHaveBeenCalledWith({}, 'shift_note', NOTE_ID, 'Towels low', {});
  });

  it('falls back to running inline when the publish fails', async () => {
    publishJSON.mockRejectedValue(new Error('QStash down'));
    expect(await dispatchClassification('shift_note', NOTE_ID, 'Towels low')).toEqual({
      via: 'inline',
    });
    expect(runClassification).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchClassifications', () => {
  const items = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      text: `Note ${i}`,
    }));

  beforeEach(() => {
    vi.stubEnv('QSTASH_TOKEN', 'qs_token');
    vi.stubEnv('CRON_SECRET', 'cron_secret');
    vi.stubEnv('PUBLIC_EMAIL_ASSET_BASE', 'https://integrations.pyre.test/assets');
    batchJSON.mockReset().mockResolvedValue([]);
    waitUntil.mockReset();
    runClassification.mockReset().mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('publishes in batches of 100, each job forced and attributed', async () => {
    const outcome = await dispatchClassifications('shift_note', items(250), {
      force: true,
      requestedBy: 'wes@pyresauna.com',
    });
    expect(outcome).toEqual({ via: 'qstash', queued: 250 });
    expect(batchJSON.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([100, 100, 50]);
    const firstBatch = batchJSON.mock.calls[0]?.[0] as Array<{ body: unknown }>;
    expect(firstBatch[0]?.body).toEqual({
      subject: 'shift_note',
      id: items(1)[0]?.id,
      force: true,
      requestedBy: 'wes@pyresauna.com',
    });
  });

  it('runs a few at a time in the background without QStash', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    expect(await dispatchClassifications('shift_note', items(5), { force: true })).toEqual({
      via: 'inline',
      queued: 5,
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(runClassification).toHaveBeenCalledTimes(5);
  });

  it('queues nothing for an empty list', async () => {
    expect(await dispatchClassifications('shift_note', [])).toEqual({
      via: 'none',
      reason: 'nothing to classify',
    });
    expect(batchJSON).not.toHaveBeenCalled();
  });
});
