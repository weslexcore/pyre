import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyCardComment, notifyGoalComment } from './goals';

const { listStaff } = vi.hoisted(() => ({ listStaff: vi.fn() }));
vi.mock('@/lib/auth/access', () => ({ listStaff }));

const roster = ['actor', 'owner', 'member', 'outsider', 'revoked'].map((name) => ({
  id: name,
  email: `${name}@pyre.test`,
  display_name: name,
  active: name !== 'revoked',
  is_admin: false,
  is_shift_lead: false,
  pages: ['outsider', 'revoked'].includes(name) ? [] : ['board:rentals'],
}));
const card = {
  id: 'card',
  title: 'A task',
  owner_email: 'owner@pyre.test',
  due_date: null,
  goal_id: null,
};
function database() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return { db: { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient, insert };
}

beforeEach(() => listStaff.mockResolvedValue(roster));

describe('comment notifications', () => {
  it('notifies the owner and mentioned readers once, excluding the author and unauthorized users', async () => {
    const { db, insert } = database();
    await notifyCardComment(
      db,
      card,
      { slug: 'rentals' },
      '@owner@pyre.test @member@pyre.test @member@pyre.test @actor@pyre.test @outsider@pyre.test @revoked@pyre.test',
      'actor@pyre.test'
    );
    const rows = insert.mock.calls[0][0];
    expect(rows.map((row: { recipient_email: string }) => row.recipient_email)).toEqual([
      'owner@pyre.test',
      'member@pyre.test',
    ]);
    expect(rows[1]).toMatchObject({
      href: '/admin/boards/rentals#card-card',
      source_type: 'board_card',
      source_id: 'card',
    });
  });

  it('notifies users with board access who are not available to schedule', async () => {
    listStaff.mockResolvedValue(roster.map((row) => ({ ...row, active: false })));
    const { db, insert } = database();
    await notifyCardComment(db, card, { slug: 'rentals' }, '@member@pyre.test', 'actor@pyre.test');
    expect(insert.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipient_email: 'member@pyre.test',
          href: '/admin/boards/rentals#card-card',
        }),
      ])
    );
  });

  it('delivers mentions even when the card has no owner or its author owns it', async () => {
    for (const owner_email of [null, 'actor@pyre.test']) {
      const { db, insert } = database();
      await notifyCardComment(
        db,
        { ...card, owner_email },
        { slug: 'rentals' },
        '@member@pyre.test',
        'actor@pyre.test'
      );
      expect(
        insert.mock.calls[0][0].map((row: { recipient_email: string }) => row.recipient_email)
      ).toEqual(['member@pyre.test']);
    }
  });

  it('links goal mentions to a serving board the recipient can open', async () => {
    const { db, insert } = database();
    await notifyGoalComment(
      db,
      { id: 'goal', title: 'Goal', owner_email: null },
      { slug: 'other' },
      '@member@pyre.test',
      'actor@pyre.test',
      [{ slug: 'other' }, { slug: 'rentals' }]
    );
    expect(insert.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        recipient_email: 'member@pyre.test',
        href: '/admin/boards/rentals',
        source_type: 'goal',
      }),
    ]);
  });
});
