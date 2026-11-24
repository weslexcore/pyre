import type { Contact } from 'resend';
import { describe, expect, it, vi } from 'vitest';
import {
  emptyTally,
  fetchAllContacts,
  loadSuppressedEmails,
  pacedCall,
  reconcileContacts,
} from './resend-sync';

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
      update: vi.fn(async () => ({ data: { id: 'x' }, error: null })),
    },
  };
}

describe('reconcileContacts', () => {
  it('marks suppressed contacts unsubscribed in Resend', async () => {
    const resend = fakeResend();
    const tally = emptyTally();
    await reconcileContacts(
      [contact('Gone@Example.com', false, 'c1'), contact('stay@example.com')],
      {
        resend: resend as never,
        pace: noPace,
        suppressed: new Set(['gone@example.com']),
        suppress: vi.fn(),
        dryRun: false,
      },
      tally
    );
    expect(resend.contacts.update).toHaveBeenCalledWith({ id: 'c1', unsubscribed: true });
    expect(resend.contacts.update).toHaveBeenCalledTimes(1);
    expect(tally.markedUnsubscribed).toEqual(['gone@example.com']);
    expect(tally.scanned).toBe(2);
  });

  it('suppresses a contact Resend has unsubscribed but we never heard about', async () => {
    const suppress = vi.fn(async () => {});
    const suppressed = new Set<string>();
    const tally = emptyTally();
    await reconcileContacts(
      [contact('missed@example.com', true)],
      { resend: fakeResend() as never, pace: noPace, suppressed, suppress, dryRun: false },
      tally
    );
    expect(suppress).toHaveBeenCalledWith('missed@example.com');
    expect(suppressed.has('missed@example.com')).toBe(true);
    expect(tally.newSuppressions).toEqual(['missed@example.com']);
  });

  it('leaves agreeing contacts alone', async () => {
    const resend = fakeResend();
    const suppress = vi.fn();
    const tally = emptyTally();
    await reconcileContacts(
      [contact('a@example.com'), contact('b@example.com', true)],
      {
        resend: resend as never,
        pace: noPace,
        suppressed: new Set(['b@example.com']),
        suppress,
        dryRun: false,
      },
      tally
    );
    expect(resend.contacts.update).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
  });

  it('only reports in a dry run', async () => {
    const resend = fakeResend();
    const suppress = vi.fn();
    const tally = emptyTally();
    await reconcileContacts(
      [contact('gone@example.com'), contact('missed@example.com', true)],
      {
        resend: resend as never,
        pace: noPace,
        suppressed: new Set(['gone@example.com']),
        suppress,
        dryRun: true,
      },
      tally
    );
    expect(resend.contacts.update).not.toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
    expect(tally.markedUnsubscribed).toEqual(['gone@example.com']);
    expect(tally.newSuppressions).toEqual(['missed@example.com']);
  });

  it('records a failed update and carries on', async () => {
    const resend = fakeResend();
    resend.contacts.update.mockResolvedValueOnce({
      data: null,
      error: { name: 'not_found', message: 'gone' },
    } as never);
    const tally = emptyTally();
    await reconcileContacts(
      [contact('a@example.com'), contact('b@example.com')],
      {
        resend: resend as never,
        pace: noPace,
        suppressed: new Set(['a@example.com', 'b@example.com']),
        suppress: vi.fn(),
        dryRun: false,
      },
      tally
    );
    expect(resend.contacts.update).toHaveBeenCalledTimes(2);
    expect(tally.errors).toEqual(['mark a@example.com: gone']);
  });
});

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
