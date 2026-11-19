// /account. Momence OAuth isn't exercised (it needs real client credentials);
// the session and member APIs are stubbed in the browser to drive the
// signed-in UI: a member with a membership, credits, upcoming bookings and
// history, and every way cancelling a booking can go.

import type { Page, Request, Route } from '@playwright/test';
import { allowConsole, stubJson } from '@pyre/e2e-utils';
import { accountConfig } from '../src/lib/account-config';
import type {
  MemberCredits,
  MemberMembership,
  MemberSession,
} from '../src/lib/momence-member-types';
import { expect, test } from './test';

const USER = { id: 4242, email: 'member@example.com', firstName: 'Morgan', lastName: 'Member' };

const inDays = (days: number, hourUtc = 22) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
};

function session(
  overrides: Partial<MemberSession> & Pick<MemberSession, 'bookingId' | 'title'>
): MemberSession {
  return {
    id: overrides.bookingId,
    eventId: overrides.bookingId + 1000,
    dateTime: inDays(3),
    duration: 60,
    location: 'Pyre Sauna',
    status: 'confirmed',
    canCancel: true,
    ...overrides,
  };
}

const MEMBERSHIP: MemberMembership = {
  id: 77,
  name: 'E2E Ember Membership',
  status: 'active',
  startDate: inDays(-20),
  renewalDate: inDays(10),
  autoRenew: true,
  credits: { total: 8, used: 3, remaining: 5, unlimited: false },
};
const CREDITS: MemberCredits = { available: 5, unlimited: false, source: '10-Pack' };

const UPCOMING = [
  session({ bookingId: 501, title: 'E2E Guided Sauna', teacherName: 'Avery Fixture' }),
  session({ bookingId: 502, title: 'E2E Social Evening', dateTime: inDays(5) }),
  session({ bookingId: 503, title: 'E2E Late Booking', dateTime: inDays(1), canCancel: false }),
];
const ATTENDED = [
  session({ bookingId: 401, title: 'E2E Past Visit', dateTime: inDays(-4), status: 'attended' }),
];

/** Stub a signed-in member. Returns the cancel requests the page sends. */
async function signIn(
  page: Page,
  options: {
    upcoming?: MemberSession[];
    sessionsStatus?: number;
    cancel?: (route: Route) => Promise<void> | void;
  } = {}
): Promise<Request[]> {
  await stubJson(page, '**/api/auth/session', {
    isAuthenticated: true,
    user: USER,
    expiresAt: Date.now() + 3_600_000,
  });
  await stubJson(page, '**/api/member/memberships', {
    memberships: [MEMBERSHIP],
    credits: CREDITS,
  });
  await stubJson(page, '**/api/member/credits', { credits: CREDITS });
  await stubJson(page, '**/api/member/referral', { error: 'unavailable' }, { status: 404 });
  await page.route('**/api/member/sessions?*', (route) => {
    if (options.sessionsStatus) {
      return route.fulfill({
        status: options.sessionsStatus,
        json: { error: 'not_authenticated' },
      });
    }
    const type = new URL(route.request().url()).searchParams.get('type');
    return route.fulfill({
      json: { sessions: type === 'attended' ? ATTENDED : (options.upcoming ?? UPCOMING) },
    });
  });
  const cancels: Request[] = [];
  await page.route('**/api/member/sessions/*', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    cancels.push(route.request());
    if (options.cancel) return options.cancel(route);
    return route.fulfill({ json: { success: true, message: 'Booking cancelled successfully' } });
  });
  return cancels;
}

const upcoming = (page: Page) => page.locator('#sessions');
const booking = (page: Page, title: string) =>
  upcoming(page)
    .locator('[data-member-booking]')
    .filter({ has: page.getByRole('heading', { name: title }) });

test('signed out, it offers login and sign-up', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: accountConfig.loginPrompt.title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();
});

test.describe('signed in', () => {
  test.use({
    consoleAllowlist: allowConsole(/status of 40[0-4]/, /\[useMemberSessions\] Cancel failed/),
  });

  test('shows the membership, credits, bookings and history', async ({ page }) => {
    await signIn(page);
    await page.goto('/account');

    await expect(page.getByRole('heading', { name: 'Welcome back, Morgan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage Sessions' })).toHaveAttribute(
      'href',
      'https://momence.com/dashboard/u/4242/my-events'
    );

    const membership = page.locator('#membership');
    await expect(membership).toContainText(MEMBERSHIP.name);
    await expect(membership).toContainText(accountConfig.membership.renewalLabel);
    const credits = page.locator('#credits');
    await expect(credits).toContainText(String(CREDITS.available));
    await expect(credits).toContainText(`${accountConfig.credits.sourceLabel}: ${CREDITS.source}`);

    await expect(upcoming(page).getByRole('heading', { level: 3 })).toHaveText(
      UPCOMING.map((s) => s.title)
    );
    await expect(booking(page, 'E2E Guided Sauna')).toContainText('with Avery Fixture');
    // Only bookings still inside their cancellation window offer Cancel.
    await expect(upcoming(page).getByRole('button', { name: 'Cancel' })).toHaveCount(2);
    await expect(booking(page, 'E2E Late Booking').getByRole('button')).toHaveCount(0);

    const history = page.locator('#session-history');
    await expect(history).toContainText('E2E Past Visit');
    await expect(history).toContainText(accountConfig.attendedSessions.statusLabels.attended);
  });

  test('Cancel asks first, and Keep leaves the booking alone', async ({ page }) => {
    const cancels = await signIn(page);
    await page.goto('/account');

    const card = booking(page, 'E2E Guided Sauna');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await card.getByRole('button', { name: 'Keep' }).click();

    await expect(card.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    expect(cancels).toHaveLength(0);
  });

  test('a confirmed cancellation removes just that booking', async ({ page }) => {
    const cancels = await signIn(page);
    await page.goto('/account');

    const card = booking(page, 'E2E Guided Sauna');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Confirm' }).click();

    await expect(card).toHaveCount(0);
    await expect(upcoming(page).getByRole('heading', { level: 3 })).toHaveText([
      'E2E Social Evening',
      'E2E Late Booking',
    ]);
    expect(cancels.map((request) => new URL(request.url()).pathname)).toEqual([
      '/api/member/sessions/501',
    ]);
  });

  test('a failed cancellation says why and keeps the booking', async ({ page }) => {
    const message = 'Cancellation deadline has passed.';
    let fail = true;
    const cancels = await signIn(page, {
      cancel: (route) =>
        fail
          ? route.fulfill({
              status: 403,
              json: { success: false, error: 'cancel_failed', message },
            })
          : route.fulfill({ json: { success: true } }),
    });
    await page.goto('/account');

    const card = booking(page, 'E2E Guided Sauna');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Confirm' }).click();

    await expect(card.getByRole('alert')).toHaveText(message);
    // Every booking is still listed, not swapped for a load error.
    await expect(upcoming(page).getByRole('heading', { level: 3 })).toHaveText(
      UPCOMING.map((s) => s.title)
    );
    await expect(upcoming(page)).not.toContainText('Failed to load sessions');

    // The visitor can try again, and this time it works.
    fail = false;
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(card).toHaveCount(0);
    expect(cancels).toHaveLength(2);
  });

  test('a cancellation in flight is sent once, however often Confirm is pressed', async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancels = await signIn(page, {
      cancel: async (route) => {
        await held;
        await route.fulfill({ json: { success: true } });
      },
    });
    await page.goto('/account');

    const card = booking(page, 'E2E Guided Sauna');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Confirm' }).dblclick();

    const pending = card.getByRole('button', { name: 'Cancelling...' });
    await expect(pending).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Keep' })).toBeDisabled();
    await pending.click({ force: true });
    expect(cancels).toHaveLength(1);

    release();
    await expect(card).toHaveCount(0);
    expect(cancels).toHaveLength(1);
  });

  test('when the sign-in expires mid-visit, cancelling asks to sign in again', async ({ page }) => {
    await signIn(page, {
      cancel: (route) =>
        route.fulfill({ status: 401, json: { success: false, error: 'not_authenticated' } }),
    });
    const login = page.waitForRequest('**/api/auth/login?*');
    await page.route('**/api/auth/login?*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Momence sign-in</title>' })
    );
    await page.goto('/account');

    const card = booking(page, 'E2E Guided Sauna');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Confirm' }).click();

    await expect(card.getByRole('alert')).toContainText(accountConfig.sessions.sessionExpired);
    await expect(upcoming(page).getByRole('heading', { level: 3 })).toHaveCount(UPCOMING.length);

    await card.getByRole('button', { name: accountConfig.sessions.signInAgainButton }).click();
    expect(new URL((await login).url()).searchParams.get('returnUrl')).toBe('/account');
  });

  test('when the sign-in has expired before the bookings load, it says so', async ({ page }) => {
    await signIn(page, { sessionsStatus: 401 });
    await page.goto('/account');

    await expect(upcoming(page).getByRole('alert')).toContainText(
      accountConfig.sessions.sessionExpired
    );
    await expect(upcoming(page)).not.toContainText(accountConfig.sessions.emptyState);
    await expect(
      upcoming(page).getByRole('button', { name: accountConfig.sessions.signInAgainButton })
    ).toBeVisible();
  });
});
