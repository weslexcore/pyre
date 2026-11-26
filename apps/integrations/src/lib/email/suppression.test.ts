import { beforeEach, describe, expect, it, vi } from 'vitest';

const markResendContactUnsubscribed = vi.fn(async (_email: string) => {});
const setSubscriberStatus = vi.fn(async (_email: string, _status: string) => {});
let insertResult: { error: { message: string; code?: string } | null };
let lookupResult: { data: unknown; error: { message: string } | null };
let dbAvailable = true;

const db = {
  from: () => ({
    insert: async () => insertResult,
    select: () => ({ eq: () => ({ maybeSingle: async () => lookupResult }) }),
  }),
};

vi.mock('@/lib/db', () => ({ getDb: () => (dbAvailable ? db : null) }));
vi.mock('./audience', () => ({
  markResendContactUnsubscribed: (email: string) => markResendContactUnsubscribed(email),
}));
vi.mock('@pyre/webhook-core', () => ({
  setSubscriberStatus: (email: string, status: string) => setSubscriberStatus(email, status),
}));

const { isSuppressed, lookupSuppression, suppressEmail } = await import('./suppression');

beforeEach(() => {
  markResendContactUnsubscribed.mockClear();
  setSubscriberStatus.mockClear();
  dbAvailable = true;
});

describe('suppressEmail', () => {
  it('mirrors a new suppression to Resend and Mailchimp', async () => {
    insertResult = { error: null };
    await suppressEmail({ email: 'A@Example.com', reason: 'unsubscribe', source: 'test' });
    expect(markResendContactUnsubscribed).toHaveBeenCalledWith('a@example.com');
    expect(setSubscriberStatus).toHaveBeenCalledWith('a@example.com', 'unsubscribed');
  });

  it('never writes an unsubscribe back to the mirror it came from', async () => {
    // Writing it back to Resend fires contact.updated again: a loop.
    insertResult = { error: null };
    await suppressEmail({
      email: 'a@example.com',
      reason: 'unsubscribe',
      source: 'resend-contact',
      from: 'resend',
    });
    expect(markResendContactUnsubscribed).not.toHaveBeenCalled();
    expect(setSubscriberStatus).toHaveBeenCalledWith('a@example.com', 'unsubscribed');
  });

  it('does not mirror again when the address was already suppressed', async () => {
    // The echo of our own Resend update arriving back through contact.updated.
    insertResult = { error: { message: 'duplicate key value', code: '23505' } };
    await suppressEmail({
      email: 'a@example.com',
      reason: 'unsubscribe',
      source: 'resend-contact',
    });
    expect(markResendContactUnsubscribed).not.toHaveBeenCalled();
    expect(setSubscriberStatus).not.toHaveBeenCalled();
  });

  it('throws when the insert fails', async () => {
    insertResult = { error: { message: 'boom' } };
    await expect(
      suppressEmail({ email: 'a@example.com', reason: 'bounce', source: 'test' })
    ).rejects.toThrow('boom');
  });
});

describe('lookupSuppression and isSuppressed', () => {
  it('answers from the table', async () => {
    lookupResult = { data: { id: '1' }, error: null };
    expect(await lookupSuppression('a@example.com')).toBe(true);
    lookupResult = { data: null, error: null };
    expect(await lookupSuppression('a@example.com')).toBe(false);
    expect(await isSuppressed('a@example.com')).toBe(false);
  });

  it('is unknown without the table, and isSuppressed fails closed', async () => {
    lookupResult = { data: null, error: { message: 'down' } };
    expect(await lookupSuppression('a@example.com')).toBeNull();
    expect(await isSuppressed('a@example.com')).toBe(true);
    dbAvailable = false;
    expect(await lookupSuppression('a@example.com')).toBeNull();
    expect(await isSuppressed('a@example.com')).toBe(true);
  });
});
