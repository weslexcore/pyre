// The schedule, end to end: /api/events and the server-rendered event pages
// run their real code against the mock Momence calendar
// (mock-server/momence-fixtures.ts).

import { allowConsole, DESKTOP_ONLY_TAG, stubJson } from '@pyre/e2e-utils';
import {
  FIXTURE_EVENTS as E,
  momenceEvents,
  SHARED_CAPACITY_EVENT as SC,
} from './mock-server/momence-fixtures';
import { expect, expectNoSidewaysScroll, test } from './test';

/** The fixture's start-end range as Pyre writes it, in Richmond time. */
function richmondTimeRange(id: number): string {
  const fixture = momenceEvents().find((event) => event.id === id);
  if (!fixture) throw new Error(`no fixture event ${id}`);
  const start = new Date(fixture.dateTime);
  const end = new Date(start.getTime() + fixture.duration * 60_000);
  const format = (date: Date) =>
    date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/New_York',
    });
  return `${format(start)} - ${format(end)}`;
}

const row = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('button').filter({ hasText: title });

test.describe('schedule', () => {
  test('lists the upcoming public sessions and nothing else', async ({ page }) => {
    await page.goto('/events');

    for (const shown of [E.guided, E.yoga, E.social, E.full]) {
      await expect(row(page, shown.title)).toBeVisible();
    }
    for (const hidden of [E.volunteer, E.cancelled, E.past]) {
      await expect(page.getByText(hidden.title)).toHaveCount(0);
    }
  });

  test('Book links go straight to the Momence checkout', async ({ page }) => {
    await page.goto('/events');

    const book = page
      .getByRole('link', { name: `Book ${E.guided.title}` })
      .filter({ visible: true });
    await expect(book).toHaveAttribute(
      'href',
      `https://momence.com/s/${E.guided.id}?skipPreview=true`
    );
    await expect(book).toHaveAttribute('target', '_blank');

    // A full session offers the waitlist instead.
    await expect(
      page
        .getByRole('link', { name: `Join waitlist for ${E.full.title}` })
        .filter({ visible: true })
    ).toBeVisible();
  });

  test('the session-type filter narrows the list and is reflected in the URL', async ({ page }) => {
    await page.goto('/events');

    const filters = page.getByRole('group', { name: 'Session type filters' });
    await expect(filters.getByRole('button')).toHaveText([
      'All',
      'Guided',
      'Social',
      'Special Event',
      'Yoga',
      'Breathwork',
    ]);

    await filters.getByRole('button', { name: 'Yoga' }).click();
    await expect(filters.getByRole('button', { name: 'Yoga' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(row(page, E.yoga.title)).toBeVisible();
    await expect(row(page, E.guided.title)).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]type=Yoga/);

    await filters.getByRole('button', { name: 'All' }).click();
    await expect(row(page, E.guided.title)).toBeVisible();
    await expect(page).not.toHaveURL(/type=/);
  });

  test('?type= deep-links a filter', async ({ page }) => {
    await page.goto('/events?type=Guided');
    await expect(row(page, E.guided.title)).toBeVisible();
    await expect(row(page, E.yoga.title)).toHaveCount(0);
  });

  test('a row opens the session details, which close again', async ({ page }) => {
    await page.goto('/events');
    await row(page, E.guided.title).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#event-detail-title')).toHaveText(E.guided.title);
    await expect(
      dialog.getByRole('link', { name: `Book ${E.guided.title}` }).first()
    ).toHaveAttribute('href', new RegExp(`momence\\.com/s/${E.guided.id}`));

    await dialog.getByRole('button', { name: 'Close details' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the session title in the details links to its event page', async ({ page }) => {
    await page.goto('/events');
    await row(page, E.guided.title).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('link', { name: E.guided.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${E.guided.id}-e2e-guided-sauna$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(E.guided.title);
  });

  test('?event= deep-links straight into a session', async ({ page }) => {
    await page.goto(`/events?event=${E.yoga.id}`);
    await expect(page.getByRole('dialog').locator('#event-detail-title')).toHaveText(E.yoga.title);
    // The param is consumed so a refresh doesn't reopen it.
    await expect(page).not.toHaveURL(/event=/);
  });

  test('Escape closes the session details', async ({ page }) => {
    await page.goto('/events');
    await row(page, E.guided.title).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('the loaded schedule and an open session fit the screen', async ({ page }) => {
    await page.goto('/events');
    await expect(row(page, E.guided.title)).toBeVisible();
    await expectNoSidewaysScroll(page);

    await row(page, E.guided.title).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test.describe('for a visitor in another timezone', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });

    test('session times stay in Richmond time', async ({ page }) => {
      await page.goto('/events');
      await expect(row(page, E.guided.title)).toContainText(richmondTimeRange(E.guided.id));
    });
  });

  test.describe('when the calendar is unavailable', () => {
    test.use({ consoleAllowlist: allowConsole(/status of 503/, /\[useEvents\] Fetch error/) });

    test('says so and recovers on retry', async ({ page }) => {
      let failing = true;
      await page.route('**/api/events', (route) =>
        failing
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ events: [], error: 'Events are temporarily unavailable' }),
            })
          : route.fallback()
      );

      await page.goto('/events');
      await expect(page.getByText("We couldn't load upcoming sessions.")).toBeVisible();

      failing = false;
      await page.getByRole('button', { name: 'Retry loading upcoming sessions' }).click();
      await expect(row(page, E.guided.title)).toBeVisible();
    });
  });

  test('an empty calendar is not shown as an error', async ({ page }) => {
    await stubJson(page, '**/api/events', {
      events: [],
      cached: false,
      timestamp: new Date().toISOString(),
      hasMore: false,
      totalUpcoming: 0,
    });
    await page.goto('/events');
    // Wait for the empty state itself, so the negatives below aren't checked
    // before /api/events has answered.
    await expect(page.getByText('No upcoming sessions at this time.')).toBeVisible();
    await expect(page.getByText("We couldn't load upcoming sessions.")).toHaveCount(0);
    await expect(row(page, E.guided.title)).toHaveCount(0);
  });
});

// Overlapping sessions of one special event (a 1hr and a 2hr at the same start,
// another 1hr after) are separate Momence sessions with their own capacities,
// but the space holds the event's capacity per hour between them.
test.describe('a special event sold in overlapping 1hr and 2hr sessions', () => {
  const slot = (page: import('@playwright/test').Page, id: number) =>
    row(page, SC.title).filter({ hasText: richmondTimeRange(id) });
  // The duration's booking row in the details: [Duration] [Credits] [N left] [Book Now].
  const option = (dialog: import('@playwright/test').Locator, label: string) =>
    dialog.getByRole('link', { name: `${label} — ${SC.title}` }).locator('..');

  test('the 2hr session is booked from the first hour, not its own row', async ({ page }) => {
    await page.goto('/events');
    await expect(slot(page, SC.firstHour.id)).toBeVisible();
    await expect(slot(page, SC.secondHour.id)).toBeVisible();
    await expect(slot(page, SC.twoHour.id)).toHaveCount(0);
  });

  test('both durations share the hourly capacity', async ({ page }) => {
    await page.goto('/events');
    await slot(page, SC.firstHour.id).click();

    const dialog = page.getByRole('dialog');
    const left = `${SC.expected.firstHourLeft} left`;
    await expect(option(dialog, 'Book 1 hour')).toContainText(left);
    await expect(option(dialog, 'Book 2 hours')).toContainText(left);
  });

  test('the next hour counts the 2hr bookings still in the space', async ({ page }) => {
    await page.goto('/events');
    await expect(slot(page, SC.secondHour.id)).toContainText(`${SC.expected.secondHourLeft} left`);
  });
});

test.describe('event page', () => {
  test('a bare id redirects to the canonical slugged URL', { tag: DESKTOP_ONLY_TAG }, async ({
    request,
  }) => {
    const response = await request.get(`/events/${E.guided.id}?utm_source=e2e`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(
      `/events/${E.guided.id}-e2e-guided-sauna?utm_source=e2e`
    );
  });

  test('renders the session server-side with a booking link and structured data', async ({
    page,
  }) => {
    await page.goto(`/events/${E.guided.id}-e2e-guided-sauna`);

    await expect(page.locator('h1')).toHaveText(E.guided.title);
    await expect(page).toHaveTitle(`${E.guided.title} — Pyre`);
    await expect(
      page.getByRole('link', { name: `Book ${E.guided.title}` }).first()
    ).toHaveAttribute('href', new RegExp(`momence\\.com/s/${E.guided.id}`));

    const schema = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(schema.some((json) => json.includes('"@type":"Event"'))).toBe(true);
  });

  test('a session that has ended says so and sends the visitor to the schedule', async ({
    page,
  }) => {
    await page.goto(`/events/${E.past.id}`);
    await expect(page).toHaveTitle('Event has ended — Pyre');
    await page.waitForURL(/\/events$/, { timeout: 10_000 });
  });

  test('a full session offers the waitlist', async ({ page }) => {
    await page.goto(`/events/${E.full.id}`);
    await expect(page.locator('h1')).toHaveText(E.full.title);
    await expect(page.getByRole('link', { name: /Join Waitlist/i }).first()).toBeVisible();
  });

  test.describe('for a visitor in another timezone', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });

    test('the start time is in Richmond time', async ({ page }) => {
      await page.goto(`/events/${E.guided.id}`);
      const start = richmondTimeRange(E.guided.id).split(' - ')[0];
      await expect(page.locator('main')).toContainText(start);
    });
  });

  // The public pipeline drops these, so their pages read as "ended" just like
  // a past session's, rather than leaking a session the schedule hides.
  for (const hidden of [E.cancelled, E.volunteer]) {
    test(`a ${hidden.title.replace('E2E ', '').toLowerCase()} is not shown`, async ({ page }) => {
      await page.goto(`/events/${hidden.id}`);
      await expect(page).toHaveTitle('Event has ended — Pyre');
      await expect(page.getByText(hidden.title)).toHaveCount(0);
    });
  }

  test('an unknown id says the session has ended', { tag: DESKTOP_ONLY_TAG }, async ({
    request,
  }) => {
    const response = await request.get('/events/123456789', { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('<title>Event has ended — Pyre</title>');
  });
});
