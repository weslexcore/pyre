// /volunteer lists work-trade shifts from /api/volunteer-events, which reads
// the mock Momence calendar and keeps only Volunteer-tagged sessions. With no
// shifts to show (none scheduled, or the calendar unavailable) the page offers
// the mailing list instead.

import type { Page } from '@playwright/test';
import { allowConsole, stubJson } from '@pyre/e2e-utils';
import { FIXTURE_EVENTS as E } from './mock-server/momence-fixtures';
import { expect, test } from './test';

const shifts = (page: Page) => page.locator('[data-volunteer-grid]');
const emptyState = (page: Page) => page.locator('[data-volunteer-empty]');

test('lists the volunteer shifts, and only those, with a sign-up link', async ({ page }) => {
  await page.goto('/volunteer');

  await expect(shifts(page).getByRole('heading', { level: 3 })).toHaveText([E.volunteer.title]);
  await expect(
    shifts(page).getByRole('link', { name: `Book ${E.volunteer.title}` })
  ).toHaveAttribute('href', `https://momence.com/s/${E.volunteer.id}?skipPreview=true`);
  await expect(emptyState(page)).toBeHidden();
});

test('with no shifts scheduled, it offers the mailing list', async ({ page }) => {
  await stubJson(page, '**/api/volunteer-events', {
    events: [],
    cached: false,
    timestamp: new Date().toISOString(),
  });
  await page.goto('/volunteer');

  await expect(emptyState(page)).toBeVisible();
  await expect(emptyState(page).locator('[data-signup-form]')).toBeVisible();
  await expect(shifts(page).getByRole('heading', { level: 3 })).toHaveCount(0);
});

test.describe('when the calendar is unavailable', () => {
  test.use({
    consoleAllowlist: allowConsole(/status of 500/, /\[VolunteerEventsGrid\] Fetch error/),
  });

  test('it offers the mailing list instead of an empty grid', async ({ page }) => {
    await stubJson(
      page,
      '**/api/volunteer-events',
      { events: [], error: 'Failed to fetch volunteer events' },
      { status: 500 }
    );
    await page.goto('/volunteer');

    await expect(emptyState(page)).toBeVisible();
    await expect(emptyState(page).locator('[data-signup-form]')).toBeVisible();
    await expect(shifts(page).getByRole('heading', { level: 3 })).toHaveCount(0);
  });
});
