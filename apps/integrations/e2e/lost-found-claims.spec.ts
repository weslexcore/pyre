// Lost and found, past the logging: staff email everyone who was in the
// session the item turned up after ("is this yours?"), a guest claims it from
// the link in that email, the item is set aside for them and staff are told.
// Guests come from the mock Momence (a session and its bookings per test);
// the emails are read back from the Resend mock.

import type { APIRequestContext, TestInfo } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueEmail, uniqueTag } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { momence, sessionAround } from './momence';
import { ADMIN, STAFF } from './roles';
import { expect, test } from './test';
import { emailsTo, linkIn, upstreamRequests } from './upstream';

const CLAIM_LINK = /\/api\/lost-found\/claim\?token=/;

interface Guest {
  id: number;
  email: string;
  name: string;
}

async function addGuest(testInfo: TestInfo, first: string): Promise<Guest> {
  const email = uniqueEmail(testInfo, `lf-${first.toLowerCase()}`);
  const lastName = uniqueTag(testInfo, 'Guest');
  const { id } = await momence.addMember({ firstName: first, lastName, email });
  return { id, email, name: `${first} ${lastName}` };
}

/** A session that ended half an hour ago with these guests in it. */
async function pastSession(testInfo: TestInfo, guests: Guest[]) {
  const session = await momence.addSession({
    name: uniqueTag(testInfo, 'Social'),
    ...sessionAround(-120, 90),
  });
  for (const guest of guests) {
    await momence.addBooking({ sessionId: session.id, memberId: guest.id });
  }
  return session;
}

interface Item {
  id: string;
  reference: string;
  title: string;
}

async function logItem(admin: APIRequestContext, testInfo: TestInfo): Promise<Item> {
  const response = await admin.post('/api/admin/lost-found', {
    data: { title: uniqueTag(testInfo, 'Blue towel'), storageLocation: 'Front desk bin' },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { item: Item }).item;
}

function notifySession(admin: APIRequestContext, item: Item, sessionId: number) {
  return admin.post('/api/admin/lost-found-notify', {
    data: { itemId: item.id, mode: 'sessions', sessionIds: [String(sessionId)] },
  });
}

/** The claim link in the "is this yours?" email a guest got about `item`. */
async function claimLinkFor(guest: Guest, item: Item): Promise<string> {
  const emails = (await emailsTo(guest.email, 'lost-found-found')).filter((e) =>
    e.html.includes(item.reference)
  );
  expect(emails, `one email to ${guest.email}`).toHaveLength(1);
  const link = linkIn(emails[0], CLAIM_LINK);
  expect(link, 'a claim link').toBeTruthy();
  const url = new URL(link as string);
  return url.pathname + url.search;
}

async function itemRow(db: SupabaseClient, id: string) {
  const { data, error } = await db
    .from('lost_found_items')
    .select('status, claimed_by_email, claimed_at')
    .eq('id', id)
    .single();
  expect(error).toBeNull();
  return data as { status: string; claimed_by_email: string | null; claimed_at: string | null };
}

async function noticesFor(db: SupabaseClient, itemId: string) {
  const { data, error } = await db
    .from('lost_found_notices')
    .select('email, response, responded_at')
    .eq('item_id', itemId)
    .order('email');
  expect(error).toBeNull();
  return (data ?? []) as { email: string; response: string | null; responded_at: string | null }[];
}

/** The staff alerts about a claim on `item` (they name its reference). */
async function claimAlerts(item: Item) {
  return (await emailsTo(ADMIN.email, 'lost-found-claimed')).filter((e) =>
    e.html.includes(item.reference)
  );
}

test.describe.configure({ mode: 'parallel' });
test.describe('lost and found claims', { tag: DESKTOP_ONLY_TAG }, () => {
  test('everyone in the session is asked, once; the first to claim gets it set aside', async ({
    as,
    db,
    request,
  }, testInfo) => {
    const admin = await as(ADMIN);
    const avery = await addGuest(testInfo, 'Avery');
    const blake = await addGuest(testInfo, 'Blake');
    const session = await pastSession(testInfo, [avery, blake]);
    const item = await logItem(admin, testInfo);

    const sent = await notifySession(admin, item, session.id);
    expect(sent.status(), await sent.text()).toBe(200);
    expect(await sent.json()).toMatchObject({ sent: 2, alreadyAsked: 0, failed: 0 });
    expect((await noticesFor(db, item.id)).map((n) => n.email)).toEqual(
      [avery.email, blake.email].sort()
    );

    // Asking the same session again emails nobody twice.
    const again = await notifySession(admin, item, session.id);
    expect(await again.json()).toMatchObject({ sent: 0, alreadyAsked: 2 });
    expect(await emailsTo(avery.email, 'lost-found-found')).toHaveLength(1);

    // Opening the link (a person, or a mail scanner prefetching it) claims nothing.
    const averyLink = await claimLinkFor(avery, item);
    const preview = await request.get(averyLink);
    expect(preview.status()).toBe(200);
    expect(await preview.text()).toContain("Yes, that's mine");
    expect((await itemRow(db, item.id)).status).toBe('unclaimed');

    // Confirming does: the item is set aside under Avery's name and staff are told.
    const claimed = await request.post(averyLink);
    expect(claimed.status()).toBe(200);
    expect(await claimed.text()).toContain(item.reference);
    const row = await itemRow(db, item.id);
    expect(row).toMatchObject({ status: 'claim_pending', claimed_by_email: avery.email });
    expect(Date.parse(row.claimed_at ?? '')).not.toBeNaN();
    await expect.poll(async () => (await claimAlerts(item)).length).toBe(1);
    expect((await claimAlerts(item))[0].html).toContain(avery.email);

    // A double tap: same confirmation, no second alert.
    expect((await request.post(averyLink)).status()).toBe(200);
    expect(await claimAlerts(item)).toHaveLength(1);

    // Blake says it's theirs too: recorded for staff to sort out at pickup,
    // but the item stays set aside for Avery.
    expect((await request.post(await claimLinkFor(blake, item))).status()).toBe(200);
    expect(await itemRow(db, item.id)).toMatchObject({ claimed_by_email: avery.email });
    expect((await noticesFor(db, item.id)).map((n) => [n.email, n.response])).toEqual(
      [
        [avery.email, 'claimed'],
        [blake.email, 'claimed'],
      ].sort()
    );
  });

  test('a link that was never sent, or for an item that has gone, claims nothing', async ({
    as,
    db,
    request,
  }, testInfo) => {
    const forged = await request.post('/api/lost-found/claim?token=not.a-real-token');
    expect(forged.status()).toBe(410);

    const admin = await as(ADMIN);
    const guest = await addGuest(testInfo, 'Casey');
    const session = await pastSession(testInfo, [guest]);
    const item = await logItem(admin, testInfo);
    expect((await notifySession(admin, item, session.id)).status()).toBe(200);
    const link = await claimLinkFor(guest, item);

    // Donated before the guest got round to it.
    const { error } = await db
      .from('lost_found_items')
      .update({ status: 'donated' })
      .eq('id', item.id);
    expect(error).toBeNull();
    const late = await request.post(link);
    expect(await late.text()).toContain('already left our hands');
    expect(await itemRow(db, item.id)).toMatchObject({ status: 'donated', claimed_by_email: null });
    expect(await claimAlerts(item)).toEqual([]);
  });

  test('only someone trusted with the queue can email guests', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const guest = await addGuest(testInfo, 'Drew');
    const session = await pastSession(testInfo, [guest]);
    const item = await logItem(admin, testInfo);

    const refused = await notifySession(await as(STAFF), item, session.id);
    expect(refused.status()).toBe(403);
    expect(await emailsTo(guest.email)).toEqual([]);
  });

  test('a session outside the item’s window cannot be emailed', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const guest = await addGuest(testInfo, 'Ellis');
    // Booked for tomorrow: nobody in it could have left something today.
    const later = await momence.addSession({
      name: uniqueTag(testInfo, 'Tomorrow'),
      ...sessionAround(24 * 60),
    });
    await momence.addBooking({ sessionId: later.id, memberId: guest.id });
    const item = await logItem(admin, testInfo);

    const response = await notifySession(admin, item, later.id);
    expect(response.status()).toBe(400);
    expect(await emailsTo(guest.email)).toEqual([]);
  });

  test('Momence being down emails nobody and says so', async ({ as, upstream }, testInfo) => {
    const admin = await as(ADMIN);
    const guest = await addGuest(testInfo, 'Frankie');
    const session = await pastSession(testInfo, [guest]);
    const item = await logItem(admin, testInfo);
    // The booking list for this test's session only.
    await upstream.fail({
      path: `/momence/api/v2/host/sessions/${session.id}/bookings`,
      bodyIncludes: String(session.id),
    });

    const response = await notifySession(admin, item, session.id);
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toMatch(/nobody was emailed/);
    expect(await emailsTo(guest.email)).toEqual([]);
    expect(
      await upstreamRequests('GET', `/momence/api/v2/host/sessions/${session.id}/bookings`)
    ).not.toEqual([]);
  });
});
