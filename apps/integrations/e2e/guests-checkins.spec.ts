// Check Ins (the floor): a guest booked into a session about to start is
// listed; checking them in records the time here and checks them in at
// Momence; checking out and undoing work. Each test books its own guest into
// its own Momence session.

import { addBooking, addGuest } from './guests-helpers';
import { momence, sessionAround } from './momence';
import { STAFF } from './roles';
import { expect, open, test } from './test';

test.use({ storageState: STAFF.storageState as string });

test('checking a guest in, out, and undoing it', async ({ page, db }, testInfo) => {
  const guest = await addGuest(testInfo, 'Avery');
  // Starting in ten minutes: inside the floor's look-ahead.
  const session = await momence.addSession({
    name: `Social ${guest.lastName}`,
    ...sessionAround(10),
  });
  const booking = await addBooking({ sessionId: session.id, memberId: guest.id });

  await open(page, '/admin/guests/check-ins');
  const row = page.getByRole('listitem').filter({ hasText: guest.name }).last();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Check in' }).click();
  await expect
    .poll(async () => {
      const { data } = await db
        .from('guest_floor_checkins')
        .select('member_id, checked_out_at')
        .eq('booking_id', booking.id)
        .maybeSingle();
      return data;
    })
    // member_id is a bigint, which PostgREST returns as a string.
    .toEqual({ member_id: String(guest.id), checked_out_at: null });
  expect(await momence.checkIns()).toContain(booking.id);

  const checkedIn = page.getByRole('listitem').filter({ hasText: guest.name }).last();
  await checkedIn.getByRole('button', { name: 'Check out' }).click();
  await expect
    .poll(async () => {
      const { data } = await db
        .from('guest_floor_checkins')
        .select('checked_out_at')
        .eq('booking_id', booking.id)
        .single();
      return data?.checked_out_at !== null;
    })
    .toBe(true);

  await page
    .getByRole('listitem')
    .filter({ hasText: guest.name })
    .last()
    .getByRole('button', { name: 'Undo check-out' })
    .click();
  await expect
    .poll(async () => {
      const { data } = await db
        .from('guest_floor_checkins')
        .select('checked_out_at')
        .eq('booking_id', booking.id)
        .single();
      return data?.checked_out_at;
    })
    .toBeNull();

  // Undoing the check-in (under Adjust) asks first, then clears it here and
  // at Momence.
  const adjusting = page.getByRole('listitem').filter({ hasText: guest.name }).last();
  await adjusting.getByRole('button', { name: 'Adjust' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await adjusting.getByRole('button', { name: 'Undo check-in' }).click();
  await expect
    .poll(
      async () =>
        (await db.from('guest_floor_checkins').select('booking_id').eq('booking_id', booking.id))
          .data
    )
    .toEqual([]);
  expect(await momence.checkIns()).not.toContain(booking.id);
});

test('a guest booked for later today is not on the floor yet', async ({ page, db }, testInfo) => {
  const guest = await addGuest(testInfo, 'Jules');
  const later = await momence.addSession({
    name: `Evening ${guest.lastName}`,
    ...sessionAround(180),
  });
  await addBooking({ sessionId: later.id, memberId: guest.id });
  const soon = await addGuest(testInfo, 'Kit');
  const now = await momence.addSession({ name: `Now ${soon.lastName}`, ...sessionAround(5) });
  await addBooking({ sessionId: now.id, memberId: soon.id });

  await open(page, '/admin/guests/check-ins');
  await expect(page.getByText(soon.name).first()).toBeVisible();
  await expect(page.getByText(guest.name)).toHaveCount(0);
});
