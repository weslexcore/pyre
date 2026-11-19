// What staff ask for and managers decide: time off, picking up a shift,
// changing your hours. Plus who may change the schedule at all, and the
// calendar feed staff subscribe to.

import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { MANAGER, STAFF, STAFF_2 } from './roles';
import { expect, test } from './schedule-helpers';

test.describe.configure({ mode: 'parallel' });

const farDay = () => 30 + Math.floor(Math.random() * 270);

test.describe('time off', { tag: DESKTOP_ONLY_TAG }, () => {
  test('staff log their own, and only their own; a manager logs anyone’s', async ({
    as,
    db,
    staffId,
    seedShift,
  }, testInfo) => {
    // Any seeded shift gives a future date to book against.
    const { date } = await seedShift({ daysAhead: farDay() });
    const note = uniqueTag(testInfo, 'time off');
    const entry = (forRole: string) => ({
      staffId: forRole,
      kind: 'range',
      startDate: date,
      endDate: date,
      note,
    });

    try {
      const own = await (await as(STAFF)).post('/api/admin/schedule-time-off', {
        data: entry(await staffId(STAFF)),
      });
      expect(own.status(), await own.text()).toBeLessThan(300);

      const someoneElse = await (await as(STAFF)).post('/api/admin/schedule-time-off', {
        data: entry(await staffId(STAFF_2)),
      });
      expect(someoneElse.status()).toBe(403);

      const byManager = await (await as(MANAGER)).post('/api/admin/schedule-time-off', {
        data: entry(await staffId(STAFF_2)),
      });
      expect(byManager.status(), await byManager.text()).toBeLessThan(300);

      const { data } = await db.from('time_off').select('staff_id, created_by').eq('note', note);
      expect(data).toHaveLength(2);
    } finally {
      await db.from('time_off').delete().eq('note', note);
    }
  });
});

test.describe('picking up a shift', { tag: DESKTOP_ONLY_TAG }, () => {
  test('staff ask, staff can’t approve, a manager approves and they’re on it', async ({
    as,
    db,
    seedShift,
    staffId,
  }) => {
    const shift = await seedShift({ daysAhead: farDay() });
    const asked = await (await as(STAFF)).post('/api/admin/shift-requests', {
      data: { shiftId: shift.id, note: 'Happy to cover' },
    });
    expect(asked.status(), await asked.text()).toBeLessThan(300);
    const { data: request } = await db
      .from('shift_requests')
      .select('id, status')
      .eq('shift_id', shift.id)
      .single();
    const id = (request as { id: string }).id;

    expect(
      (
        await (
          await as(STAFF_2)
        ).patch('/api/admin/shift-requests', { data: { id, action: 'approve' } })
      ).status()
    ).toBe(403);
    const approved = await (await as(MANAGER)).patch('/api/admin/shift-requests', {
      data: { id, action: 'approve' },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    const { data: assignments } = await db
      .from('shift_assignments')
      .select('staff_id')
      .eq('shift_id', shift.id);
    expect(assignments).toEqual([{ staff_id: await staffId(STAFF) }]);
  });

  test('you can’t ask for a shift you’re already on', async ({ as, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF], daysAhead: farDay() });
    const response = await (await as(STAFF)).post('/api/admin/shift-requests', {
      data: { shiftId: shift.id },
    });
    expect(response.status()).toBe(409);
  });
});

test.describe('changing your hours', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a manager approves new hours and the shift follows', async ({ as, db, seedShift }) => {
    const shift = await seedShift({
      staff: [STAFF],
      daysAhead: farDay(),
      startsAt: '10:00',
      endsAt: '14:00',
    });
    const assignmentId = shift.assignments[STAFF.email];

    const asked = await (await as(STAFF)).post('/api/admin/hours-change-requests', {
      data: { assignmentId, startsAt: '11:00', endsAt: '14:00', note: 'Late start' },
    });
    expect(asked.status(), await asked.text()).toBeLessThan(300);
    const { data: request } = await db
      .from('hours_change_requests')
      .select('id')
      .eq('assignment_id', assignmentId)
      .single();
    const approved = await (await as(MANAGER)).patch('/api/admin/hours-change-requests', {
      data: { id: (request as { id: string }).id, action: 'approve' },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    const { data: assignment } = await db
      .from('shift_assignments')
      .select('starts_at, ends_at')
      .eq('id', assignmentId)
      .single();
    expect(assignment).toEqual({ starts_at: '11:00:00', ends_at: '14:00:00' });
  });

  test('you can only change your own hours', async ({ as, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF_2], daysAhead: farDay() });
    const response = await (await as(STAFF)).post('/api/admin/hours-change-requests', {
      data: { assignmentId: shift.assignments[STAFF_2.email], startsAt: '06:00', endsAt: '23:00' },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('changing the schedule', { tag: DESKTOP_ONLY_TAG }, () => {
  test('staff can’t create or edit shifts; a manager can', async ({
    as,
    db,
    seedShift,
  }, testInfo) => {
    const label = uniqueTag(testInfo, 'E2E manager shift');
    const fields = { shiftDate: '2030-01-15', label, startsAt: '10:00', endsAt: '12:00' };
    try {
      expect((await (await as(STAFF)).post('/api/admin/shifts', { data: fields })).status()).toBe(
        403
      );
      const created = await (await as(MANAGER)).post('/api/admin/shifts', { data: fields });
      expect(created.status(), await created.text()).toBeLessThan(300);

      const shift = await seedShift({ daysAhead: farDay() });
      expect(
        (
          await (
            await as(STAFF)
          ).patch('/api/admin/shifts', { data: { id: shift.id, label: 'Hijacked' } })
        ).status()
      ).toBe(403);
      const edited = await (await as(MANAGER)).patch('/api/admin/shifts', {
        data: { id: shift.id, label: `${shift.label} (moved)` },
      });
      expect(edited.status(), await edited.text()).toBe(200);
    } finally {
      await db.from('shifts').delete().eq('label', label);
    }
  });
});

test.describe('calendar feed', { tag: DESKTOP_ONLY_TAG }, () => {
  test('your feed lists your shifts by its secret link', async ({ as, request, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF] });
    const urls = await (await (await as(STAFF)).get('/api/admin/calendar-feed')).json();
    expect(urls.teamFeedUrl).toBeNull();

    // No cookie: the token in the link is the only credential.
    const feed = await request.get(new URL(urls.feedUrl).pathname + new URL(urls.feedUrl).search);
    expect(feed.status()).toBe(200);
    expect(feed.headers()['content-type']).toContain('text/calendar');
    expect(await feed.text()).toContain(shift.label);

    const team = await request.get(
      `${new URL(urls.feedUrl).pathname}${new URL(urls.feedUrl).search}&scope=team`
    );
    expect(team.status()).toBe(403);
  });

  test('a manager gets the team feed', async ({ as, request }) => {
    const urls = await (await (await as(MANAGER)).get('/api/admin/calendar-feed')).json();
    expect(urls.teamFeedUrl).toBeTruthy();
    const team = await request.get(
      new URL(urls.teamFeedUrl).pathname + new URL(urls.teamFeedUrl).search
    );
    expect(team.status()).toBe(200);
  });

  test('an unknown token finds nothing', async ({ request }) => {
    expect((await request.get('/api/schedule/feed.ics?t=not-a-token')).status()).toBe(404);
  });
});
