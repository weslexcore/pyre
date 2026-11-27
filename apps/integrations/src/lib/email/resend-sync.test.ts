import type { Contact } from 'resend';
import { describe, expect, it, vi } from 'vitest';
import { fetchAllContacts, loadSuppressedEmails, pacedCall } from './resend-sync';

const noPace = async () => {};

const contact = (email: string, unsubscribed = false, id = email): Contact => ({
  id,
  email,
  unsubscribed,
  created_at: '2026-11-01T00:00:00Z',
  first_name: null,
  last_name: null,
});

function fakeResend(pages: Contact[][] = []) {
  return {
    contacts: {
      list: vi.fn(async ({ after }: { after?: string }) => {
        const index = after ? Number(after.replace('page-', '')) : 0;
        const data = pages[index] ?? [];
        const hasMore = index + 1 < pages.length;
        // The cursor is the last contact's id, as with Resend.
        if (hasMore && data.length > 0) data[data.length - 1].id = `page-${index + 1}`;
        return { data: { object: 'list', data, has_more: hasMore }, error: null };
      }),
    },
  };
}

describe('fetchAllContacts', () => {
  it('follows the cursor through every page', async () => {
    const resend = fakeResend([
      [contact('a@example.com'), contact('b@example.com')],
      [contact('c@example.com')],
    ]);
    const all = await fetchAllContacts(resend as never, noPace);
    expect(all.map((c) => c.email)).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    expect(resend.contacts.list).toHaveBeenCalledTimes(2);
  });
});

describe('pacedCall', () => {
  it('retries when Resend rate-limits', async () => {
    vi.useFakeTimers();
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { name: 'rate_limit_exceeded', message: 'slow' },
      })
      .mockResolvedValueOnce({ data: 'ok', error: null });
    const result = pacedCall(noPace, call);
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ data: 'ok', error: null });
    expect(call).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('loadSuppressedEmails', () => {
  it('reads every page, lowercased', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ email: `User${i}@Example.com` }));
    const range = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));
    const db = { from: () => ({ select: () => ({ order: () => ({ range }) }) }) };
    const emails = await loadSuppressedEmails(db as never);
    expect(emails.size).toBe(1500);
    expect(emails.has('user1499@example.com')).toBe(true);
    expect(range).toHaveBeenCalledTimes(2);
  });
});
