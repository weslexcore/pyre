// Sub requests: someone on a shift asks for cover, teammates are told (in the
// app and by email, with a one-tap claim link), and the first to take it
// replaces them on the shift.

import { request } from '@playwright/test';
import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_URL } from './env';
import { ADMIN, MANAGER, SHIFT_LEAD, STAFF, STAFF_2 } from './roles';
import { boardUrl, expect, type SeededShift, test } from './schedule-helpers';
import { mock, open } from './test';

async function subFor(db: SupabaseClient, shiftId: string) {
  const { data, error } = await db
    .from('sub_requests')
    .select('id, status, claimed_by_staff_id, time_off_id')
    .eq('shift_id', shiftId)
    .maybeSingle();
  expect(error).toBeNull();
  return data as {
    id: string;
    status: string;
    claimed_by_staff_id: string | null;
    time_off_id: string | null;
  } | null;
}

async function assigneeIds(db: SupabaseClient, shiftId: string): Promise<string[]> {
  const { data, error } = await db
    .from('shift_assignments')
    .select('staff_id')
    .eq('shift_id', shiftId);
  expect(error).toBeNull();
  return ((data ?? []) as { staff_id: string }[]).map((row) => row.staff_id);
}

/** The emails the Resend mock received for this shift (its label is in the body). */
async function emailsAbout(shift: SeededShift) {
  const requests = await mock.requests();
  return requests
    .filter((r) => r.method === 'POST' && r.path === '/resend/emails')
    .map((r) => r.body as { to: string | string[]; subject: string; html: string })
    .filter((email) => email.html?.includes(shift.label));
}

const recipients = (email: { to: string | string[] }) => [email.to].flat();

test.beforeAll(async () => {
  // Sub emails are still dark (not live) in this environment, so they only
  // reach whitelisted addresses. Whitelisting through the admin API also
  // clears the app's cached email gate.
  const admin = await request.newContext({
    baseURL: APP_URL,
    storageState: ADMIN.storageState as string,
  });
  for (const email of [STAFF_2.email]) {
    const response = await admin.post('/api/admin/email-gate', {
      data: { action: 'add-whitelist', email },
    });
    expect(response.ok(), `whitelist ${email}`).toBeTruthy();
  }
  await admin.dispose();
});

test.describe('on the board', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('a teammate takes a shift someone asked a sub for', async ({
    page,
    pageAs,
    db,
    seedShift,
    staffId,
  }) => {
    const shift = await seedShift({ staff: [STAFF] });

    // Sam asks for a sub from their own shift card.
    await open(page, boardUrl(shift));
    const card = page.locator(`#shift-${shift.id}`);
    await card.getByRole('button', { name: 'request a sub' }).click();
    await card.getByLabel('Reason for the sub request').fill('Dentist');
    await card.getByRole('button', { name: 'Request sub' }).click();
    await expect.poll(async () => (await subFor(db, shift.id))?.status).toBe('open');

    // Casey is told: an in-app notification and, being available, an email
    // with a claim link.
    const caseyId = await staffId(STAFF_2);
    // The sub row is written first; the notifications follow once the emails
    // have gone out, while the request is still running.
    const subId = (await subFor(db, shift.id))?.id as string;
    await expect
      .poll(
        async () => {
          const { data } = await db
            .from('staff_notifications')
            .select('kind')
            .eq('recipient_email', STAFF_2.email)
            .eq('source_id', subId);
          return data?.length ?? 0;
        },
        { message: 'Casey has a notification' }
      )
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        (await emailsAbout(shift)).some((e) => recipients(e).includes(STAFF_2.email))
      )
      .toBe(true);

    // Casey takes it from the board, on the same kind of device (and under
    // the same browser-error guard as Sam's page).
    const caseyPage = await pageAs(STAFF_2);
    await open(caseyPage, boardUrl(shift));
    await caseyPage
      .locator(`#shift-${shift.id}`)
      .getByRole('button', { name: 'Take this shift' })
      .click();
    await caseyPage.getByRole('dialog').getByRole('button', { name: 'Take shift' }).click();

    await expect.poll(async () => (await subFor(db, shift.id))?.status).toBe('claimed');
    // The claim marks the request first, then moves the assignment.
    await expect.poll(() => assigneeIds(db, shift.id)).toEqual([caseyId]);
  });
});

test.describe('the emailed claim link', () => {
  test('takes the shift without signing in', async ({ as, db, seedShift, staffId, page }) => {
    const shift = await seedShift({ staff: [STAFF] });
    const sam = await as(STAFF);
    expect((await sam.post('/api/admin/shift-sub', { data: { shiftId: shift.id } })).status()).toBe(
      201
    );

    // The link from the email Casey got, followed in a signed-out browser.
    let link: string | undefined;
    await expect
      .poll(async () => {
        const email = (await emailsAbout(shift)).find((e) => recipients(e).includes(STAFF_2.email));
        link = email?.html.match(/href="([^"]*\/api\/schedule\/sub-claim\?token=[^"]+)"/)?.[1];
        return Boolean(link);
      })
      .toBe(true);
    const response = await page.goto((link as string).replace(/&amp;/g, '&'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toContainText(/yours|taken|you're on/i);

    expect((await subFor(db, shift.id))?.status).toBe('claimed');
    const caseyId = await staffId(STAFF_2);
    await expect.poll(() => assigneeIds(db, shift.id)).toEqual([caseyId]);
  });

  test('a forged link is refused', { tag: DESKTOP_ONLY_TAG }, async ({ request }) => {
    const response = await request.get('/api/schedule/sub-claim?token=not.a-real-token');
    expect(response.status()).toBe(400);
  });
});

test.describe('the rules', { tag: DESKTOP_ONLY_TAG }, () => {
  test('you cannot take your own sub request', async ({ as, db, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF] });
    const sam = await as(STAFF);
    await sam.post('/api/admin/shift-sub', { data: { shiftId: shift.id } });
    const sub = await subFor(db, shift.id);

    const response = await sam.patch('/api/admin/shift-sub', {
      data: { id: sub?.id, action: 'claim' },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/your own sub request/);
  });

  test('a claimed shift cannot be claimed again', async ({ as, db, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF] });
    await (await as(STAFF)).post('/api/admin/shift-sub', { data: { shiftId: shift.id } });
    const sub = await subFor(db, shift.id);

    expect(
      (
        await (
          await as(STAFF_2)
        ).patch('/api/admin/shift-sub', { data: { id: sub?.id, action: 'claim' } })
      ).status()
    ).toBe(200);
    const second = await (await as(ADMIN)).patch('/api/admin/shift-sub', {
      data: { id: sub?.id, action: 'claim' },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).error).toMatch(/already took this shift/);
  });

  test('people taking the same sub at once: exactly one gets it', async ({
    as,
    db,
    seedShift,
    staffId,
  }) => {
    const shift = await seedShift({ staff: [STAFF] });
    const asked = await (await as(STAFF)).post('/api/admin/shift-sub', {
      data: { shiftId: shift.id },
    });
    expect(asked.status(), await asked.text()).toBe(201);
    const sub = await subFor(db, shift.id);
    expect(sub?.status).toBe('open');

    // Three teammates tap "Take shift" at the same moment.
    const rivals = [STAFF_2, SHIFT_LEAD, MANAGER];
    const clients = await Promise.all(rivals.map((role) => as(role)));
    const responses = await Promise.all(
      clients.map((client) =>
        client.patch('/api/admin/shift-sub', { data: { id: sub?.id, action: 'claim' } })
      )
    );
    const statuses = responses.map((response) => response.status());
    expect(
      statuses.filter((status) => status === 200),
      `statuses ${statuses}`
    ).toHaveLength(1);
    expect(
      statuses.filter((status) => status === 409),
      `statuses ${statuses}`
    ).toHaveLength(2);
    for (const lost of responses.filter((response) => response.status() === 409)) {
      expect((await lost.json()).error).toMatch(/already took this shift/);
    }

    // The one who won is on the shift, alone, and the request names them.
    const winnerId = await staffId(rivals[statuses.indexOf(200)]);
    const claimed = await subFor(db, shift.id);
    expect(claimed).toMatchObject({ status: 'claimed', claimed_by_staff_id: winnerId });
    await expect.poll(() => assigneeIds(db, shift.id)).toEqual([winnerId]);
  });

  test('a shift in the past cannot be subbed out', async ({ as, seedShift, days }) => {
    const shift = await seedShift({ staff: [STAFF], daysAhead: days.past(2) });
    const response = await (await as(STAFF)).post('/api/admin/shift-sub', {
      data: { shiftId: shift.id },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toMatch(/in the past/);
  });

  test('you can only ask for a sub on your own shift', async ({ as, seedShift }) => {
    const shift = await seedShift({ staff: [STAFF] });
    const response = await (await as(STAFF_2)).post('/api/admin/shift-sub', {
      data: { shiftId: shift.id },
    });
    expect(response.status()).toBe(404);
  });

  test('only the requester cancels, and cancelling clears the time off', async ({
    as,
    db,
    seedShift,
  }) => {
    const shift = await seedShift({ staff: [STAFF] });
    await (await as(STAFF)).post('/api/admin/shift-sub', { data: { shiftId: shift.id } });
    const sub = await subFor(db, shift.id);
    expect(sub?.time_off_id).toBeTruthy();

    expect((await (await as(STAFF_2)).delete(`/api/admin/shift-sub?id=${sub?.id}`)).status()).toBe(
      403
    );
    expect((await (await as(STAFF)).delete(`/api/admin/shift-sub?id=${sub?.id}`)).status()).toBe(
      200
    );

    expect((await subFor(db, shift.id))?.status).toBe('cancelled');
    const { data: timeOff } = await db
      .from('time_off')
      .select('id')
      .eq('id', sub?.time_off_id as string);
    expect(timeOff).toEqual([]);
  });
});
