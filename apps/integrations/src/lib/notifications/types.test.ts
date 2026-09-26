import { describe, expect, it } from 'vitest';
import {
  excerpt,
  inboxSwipeAction,
  inCurrentWeek,
  isLive,
  isUnread,
  scheduleHref,
  shiftNotificationExpiry,
  sortInbox,
} from './types';

const NOW = '2026-09-14T12:00:00.000Z';

function row(overrides: Partial<Parameters<typeof isLive>[0]> & { id?: string } = {}) {
  return {
    id: 'x',
    read_at: null,
    dismissed_at: null,
    expires_at: null,
    created_at: '2026-09-14T10:00:00.000Z',
    ...overrides,
  };
}

describe('isLive / isUnread', () => {
  it('a fresh row is live and unread', () => {
    expect(isLive(row(), NOW)).toBe(true);
    expect(isUnread(row(), NOW)).toBe(true);
  });

  it('a read row stays live but is no longer unread', () => {
    const r = row({ read_at: NOW });
    expect(isLive(r, NOW)).toBe(true);
    expect(isUnread(r, NOW)).toBe(false);
  });

  it('a dismissed row is neither', () => {
    const r = row({ dismissed_at: NOW });
    expect(isLive(r, NOW)).toBe(false);
    expect(isUnread(r, NOW)).toBe(false);
  });

  it('expiry hides a row once passed, not before', () => {
    expect(isLive(row({ expires_at: '2026-09-15T00:00:00.000Z' }), NOW)).toBe(true);
    expect(isLive(row({ expires_at: '2026-09-14T11:59:00.000Z' }), NOW)).toBe(false);
    expect(isUnread(row({ expires_at: '2026-09-14T11:59:00.000Z' }), NOW)).toBe(false);
  });
});

describe('sortInbox', () => {
  it('puts unread first, newest first within each group', () => {
    const rows = [
      row({ id: 'old-read', read_at: NOW, created_at: '2026-09-10T00:00:00.000Z' }),
      row({ id: 'old-unread', created_at: '2026-09-11T00:00:00.000Z' }),
      row({ id: 'new-read', read_at: NOW, created_at: '2026-09-13T00:00:00.000Z' }),
      row({ id: 'new-unread', created_at: '2026-09-12T00:00:00.000Z' }),
    ];
    expect(sortInbox(rows, NOW).map((r) => r.id)).toEqual([
      'new-unread',
      'old-unread',
      'new-read',
      'old-read',
    ]);
  });

  it('does not mutate its input', () => {
    const rows = [row({ id: 'a', read_at: NOW }), row({ id: 'b' })];
    sortInbox(rows, NOW);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('excerpt', () => {
  it('flattens markdown to one plain line', () => {
    expect(
      excerpt(
        '# Heading\n\nSome **bold** and _quiet_ text with a [link](https://x.y) and `code`.\n\n- item'
      )
    ).toBe('Heading Some bold and quiet text with a link and code. item');
  });

  it('drops code fences and images', () => {
    expect(excerpt('Before\n```\nignored\n```\n![pic](a.png) after')).toBe('Before after');
  });

  it('cuts on a word boundary with an ellipsis', () => {
    const out = excerpt('one two three four five six seven', 14);
    expect(out).toBe('one two three…');
    expect(excerpt('short', 14)).toBe('short');
  });
});

describe('schedule helpers', () => {
  it('expires a shift notice two days after the shift date', () => {
    expect(shiftNotificationExpiry('2026-09-20')).toBe('2026-09-22T00:00:00.000Z');
  });

  it('links to the week board on the shift', () => {
    expect(scheduleHref({ id: 's1', shift_date: '2026-09-20' })).toBe(
      '/admin/schedule?view=week&date=2026-09-20&shift=s1'
    );
  });
});

describe('inCurrentWeek', () => {
  // Wed 2026-09-16; its week runs Mon 9/14 – Sun 9/20.
  const today = '2026-09-16';

  it('covers Monday through Sunday of the week containing today', () => {
    expect(inCurrentWeek('2026-09-14', today)).toBe(true);
    expect(inCurrentWeek('2026-09-16', today)).toBe(true);
    expect(inCurrentWeek('2026-09-20', today)).toBe(true);
  });

  it('leaves out next week and last week', () => {
    expect(inCurrentWeek('2026-09-21', today)).toBe(false);
    expect(inCurrentWeek('2026-09-13', today)).toBe(false);
  });

  it('starts a new week on Monday, not Sunday', () => {
    expect(inCurrentWeek('2026-09-20', '2026-09-20')).toBe(true);
    expect(inCurrentWeek('2026-09-21', '2026-09-20')).toBe(false);
    expect(inCurrentWeek('2026-09-27', '2026-09-21')).toBe(true);
  });
});

describe('inboxSwipeAction', () => {
  const both = { dismiss: true, toggleRead: true };

  it('dismisses on a left swipe and flips read state on a right one', () => {
    expect(inboxSwipeAction(true, -80, both)).toBe('dismiss');
    expect(inboxSwipeAction(true, 80, both)).toBe('read');
    expect(inboxSwipeAction(false, 80, both)).toBe('unread');
  });

  it('does nothing without movement or in a direction not offered', () => {
    expect(inboxSwipeAction(true, 0, both)).toBeNull();
    expect(inboxSwipeAction(true, -80, { dismiss: false, toggleRead: true })).toBeNull();
    expect(inboxSwipeAction(false, 80, { dismiss: true, toggleRead: false })).toBeNull();
  });
});
