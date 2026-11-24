import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertResendContact = vi.fn();
vi.mock('@/lib/email/audience', () => ({
  upsertResendContact: (...args: unknown[]) => upsertResendContact(...args),
}));

const { isMailingList, subscribeToMailingList } = await import('./subscribe');

beforeEach(() => {
  upsertResendContact.mockReset().mockResolvedValue({ status: 'created', suppressed: false });
  vi.stubEnv('RESEND_SEGMENT_ID', 'seg-newsletter');
  vi.stubEnv('RESEND_VOLUNTEER_SEGMENT_ID', 'seg-volunteer');
});

describe('subscribeToMailingList', () => {
  it('adds a newsletter sign-up to the newsletter segment, joining it if already a contact', async () => {
    const result = await subscribeToMailingList({
      email: 'a@example.com',
      list: 'newsletter',
      source: 'website_form',
    });
    expect(result).toEqual({ outcome: 'subscribed', suppressed: false });
    expect(upsertResendContact).toHaveBeenCalledWith(
      { email: 'a@example.com' },
      { extraSegmentIds: [], joinSegments: true }
    );
  });

  it('also adds a volunteer sign-up to the volunteer segment', async () => {
    await subscribeToMailingList({
      email: 'v@example.com',
      list: 'volunteer',
      source: 'volunteer',
    });
    expect(upsertResendContact.mock.calls[0][1]).toEqual({
      extraSegmentIds: ['seg-volunteer'],
      joinSegments: true,
    });
  });

  it('reports a suppressed address as subscribed, without lifting the suppression', async () => {
    upsertResendContact.mockResolvedValue({ status: 'updated', suppressed: true });
    const result = await subscribeToMailingList({
      email: 'gone@example.com',
      list: 'newsletter',
      source: 'website_form',
    });
    expect(result).toEqual({ outcome: 'subscribed', suppressed: true });
  });

  it('is unavailable without the newsletter segment or the suppression list', async () => {
    vi.stubEnv('RESEND_SEGMENT_ID', '');
    expect(
      await subscribeToMailingList({ email: 'a@example.com', list: 'newsletter', source: 'x' })
    ).toEqual({ outcome: 'unavailable', reason: 'segment-not-configured' });
    expect(upsertResendContact).not.toHaveBeenCalled();

    vi.stubEnv('RESEND_SEGMENT_ID', 'seg-newsletter');
    upsertResendContact.mockResolvedValue({ status: 'skipped', reason: 'suppression-unknown' });
    expect(
      await subscribeToMailingList({ email: 'a@example.com', list: 'newsletter', source: 'x' })
    ).toEqual({ outcome: 'unavailable', reason: 'suppression-unknown' });
  });
});

describe('isMailingList', () => {
  it('knows the lists', () => {
    expect(isMailingList('newsletter')).toBe(true);
    expect(isMailingList('volunteer')).toBe(true);
    expect(isMailingList('everyone')).toBe(false);
  });
});
