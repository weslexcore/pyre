import { beforeEach, describe, expect, it, vi } from 'vitest';

const markResendContactUnsubscribed = vi.fn(async (_email: string) => {});
const setSubscriberStatus = vi.fn(async (_email: string, _status: string) => {});
let insertResult: { error: { message: string; code?: string } | null };

const db = { from: () => ({ insert: async () => insertResult }) };

vi.mock('@/lib/db', () => ({ getDb: () => db }));
vi.mock('./audience', () => ({
  markResendContactUnsubscribed: (email: string) => markResendContactUnsubscribed(email),
}));
vi.mock('@pyre/webhook-core', () => ({
  setSubscriberStatus: (email: string, status: string) => setSubscriberStatus(email, status),
}));

const { suppressEmail } = await import('./suppression');

beforeEach(() => {
  markResendContactUnsubscribed.mockClear();
  setSubscriberStatus.mockClear();
});

describe('suppressEmail', () => {
  it('mirrors a new suppression to Resend and Mailchimp', async () => {
    insertResult = { error: null };
    await suppressEmail({ email: 'A@Example.com', reason: 'unsubscribe', source: 'test' });
    expect(markResendContactUnsubscribed).toHaveBeenCalledWith('a@example.com');
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

  it('throws when the insert fails', async () => {
    insertResult = { error: { message: 'boom' } };
    await expect(
      suppressEmail({ email: 'a@example.com', reason: 'bounce', source: 'test' })
    ).rejects.toThrow('boom');
  });
});
