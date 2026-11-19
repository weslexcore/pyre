// Swap offers: instead of taking someone's shift outright, a teammate offers
// one of their own shifts in exchange. Accepting trades the two assignments.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Role, STAFF, STAFF_2 } from './roles';
import { expect, type SeededShift, type ShiftInput, type TestDays, test } from './schedule-helpers';

test.describe.configure({ mode: 'parallel' });

async function assignee(db: SupabaseClient, shiftId: string): Promise<string[]> {
  const { data } = await db.from('shift_assignments').select('staff_id').eq('shift_id', shiftId);
  return ((data ?? []) as { staff_id: string }[]).map((row) => row.staff_id);
}

test.describe('swaps', { tag: DESKTOP_ONLY_TAG }, () => {
  /**
   * Sam asks for a sub on shift A; Casey, on shift B, offers B in exchange.
   * Different days, so Sam is free for B.
   */
  async function offerSetup({
    as,
    db,
    seedShift,
    days,
  }: {
    as: (role: Role) => Promise<APIRequestContext>;
    db: SupabaseClient;
    seedShift: (input?: ShiftInput) => Promise<SeededShift>;
    days: TestDays;
  }) {
    const day = days.ahead(0);
    const shiftA = await seedShift({ staff: [STAFF], daysAhead: day });
    const shiftB = await seedShift({ staff: [STAFF_2], daysAhead: day + 1 });
    const sam = await as(STAFF);
    const casey = await as(STAFF_2);
    expect(
      (await sam.post('/api/admin/shift-sub', { data: { shiftId: shiftA.id } })).status()
    ).toBe(201);
    const { data: sub } = await db
      .from('sub_requests')
      .select('id')
      .eq('shift_id', shiftA.id)
      .single();
    const offered = await casey.post('/api/admin/shift-swap', {
      data: { subId: (sub as { id: string }).id, shiftId: shiftB.id, note: 'Trade?' },
    });
    expect(offered.status(), await offered.text()).toBe(201);
    const { data: offer } = await db
      .from('sub_swap_offers')
      .select('id, status')
      .eq('offered_shift_id', shiftB.id)
      .single();
    return { shiftA, shiftB, sam, casey, offerId: (offer as { id: string }).id };
  }

  test('accepting trades the two shifts', async ({ as, db, seedShift, staffId, days }) => {
    const { shiftA, shiftB, sam, casey, offerId } = await offerSetup({ as, db, seedShift, days });

    // Only the person who asked can accept.
    expect(
      (
        await casey.patch('/api/admin/shift-swap', { data: { id: offerId, action: 'accept' } })
      ).status()
    ).toBe(403);
    const accepted = await sam.patch('/api/admin/shift-swap', {
      data: { id: offerId, action: 'accept' },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);

    expect(await assignee(db, shiftA.id)).toEqual([await staffId(STAFF_2)]);
    expect(await assignee(db, shiftB.id)).toEqual([await staffId(STAFF)]);
    const { data: sub } = await db
      .from('sub_requests')
      .select('status')
      .eq('shift_id', shiftA.id)
      .single();
    expect((sub as { status: string }).status).not.toBe('open');
  });

  test('declining leaves both shifts as they were', async ({
    as,
    db,
    seedShift,
    staffId,
    days,
  }) => {
    const { shiftA, shiftB, sam, offerId } = await offerSetup({ as, db, seedShift, days });

    const declined = await sam.patch('/api/admin/shift-swap', {
      data: { id: offerId, action: 'decline' },
    });
    expect(declined.status(), await declined.text()).toBe(200);

    const { data: offer } = await db
      .from('sub_swap_offers')
      .select('status')
      .eq('id', offerId)
      .single();
    expect((offer as { status: string }).status).toBe('declined');
    expect(await assignee(db, shiftA.id)).toEqual([await staffId(STAFF)]);
    expect(await assignee(db, shiftB.id)).toEqual([await staffId(STAFF_2)]);
  });

  test('only the offerer can withdraw an offer', async ({ as, db, seedShift, days }) => {
    const { sam, casey, offerId } = await offerSetup({ as, db, seedShift, days });

    expect(
      (
        await sam.patch('/api/admin/shift-swap', { data: { id: offerId, action: 'withdraw' } })
      ).status()
    ).toBe(403);
    expect(
      (
        await casey.patch('/api/admin/shift-swap', { data: { id: offerId, action: 'withdraw' } })
      ).status()
    ).toBe(200);
    const { data: offer } = await db
      .from('sub_swap_offers')
      .select('status')
      .eq('id', offerId)
      .single();
    expect((offer as { status: string }).status).toBe('withdrawn');
  });

  test('you cannot offer a swap on your own sub request', async ({ as, db, seedShift, days }) => {
    const day = days.ahead(0);
    const shiftA = await seedShift({ staff: [STAFF], daysAhead: day });
    const shiftB = await seedShift({ staff: [STAFF], daysAhead: day + 1 });
    const sam = await as(STAFF);
    await sam.post('/api/admin/shift-sub', { data: { shiftId: shiftA.id } });
    const { data: sub } = await db
      .from('sub_requests')
      .select('id')
      .eq('shift_id', shiftA.id)
      .single();

    const response = await sam.post('/api/admin/shift-swap', {
      data: { subId: (sub as { id: string }).id, shiftId: shiftB.id },
    });
    expect(response.status()).toBe(400);
  });
});
