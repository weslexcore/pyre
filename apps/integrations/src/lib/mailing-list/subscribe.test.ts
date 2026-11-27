import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
let dbAvailable = true;
vi.mock('@/lib/db', () => ({
  getDb: () => (dbAvailable ? { rpc: (...args: unknown[]) => rpc(...args) } : null),
}));

const { isMailingList, subscribeToMailingList } = await import('./subscribe');

beforeEach(() => {
  dbAvailable = true;
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('subscribeToMailingList', () => {
  it('adds a newsletter sign-up to the newsletter list', async () => {
    const result = await subscribeToMailingList({
      email: ' A@Example.com ',
      list: 'newsletter',
      source: 'website_form',
    });
    expect(result).toEqual({ outcome: 'subscribed' });
    expect(rpc).toHaveBeenCalledWith('newsletter_subscribe', {
      p_email: 'a@example.com',
      p_lists: ['newsletter'],
      p_source: 'website_form',
      p_first_name: null,
      p_last_name: null,
    });
  });

  it('puts a volunteer on both lists and passes names through', async () => {
    await subscribeToMailingList({
      email: 'v@example.com',
      list: 'volunteer',
      source: 'volunteer',
      firstName: 'Vee',
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_lists: ['newsletter', 'volunteer'],
      p_first_name: 'Vee',
    });
  });

  it('reports the list unavailable without a database or when the write fails', async () => {
    dbAvailable = false;
    expect(
      await subscribeToMailingList({ email: 'a@example.com', list: 'newsletter', source: 'x' })
    ).toEqual({ outcome: 'unavailable', reason: 'no-db' });

    dbAvailable = true;
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(
      await subscribeToMailingList({ email: 'a@example.com', list: 'newsletter', source: 'x' })
    ).toEqual({ outcome: 'unavailable', reason: 'db-error' });
  });
});

describe('isMailingList', () => {
  it('knows the lists', () => {
    expect(isMailingList('newsletter')).toBe(true);
    expect(isMailingList('volunteer')).toBe(true);
    expect(isMailingList('everyone')).toBe(false);
    expect(isMailingList(undefined)).toBe(false);
  });
});
