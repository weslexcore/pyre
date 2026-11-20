// Every dashboard page opens for an admin: each tool, the pages nested under
// them (calendar, timesheet, plunges, check-ins, ...), home, messages and
// notifications. The list is the admin's own page search (searchablePages),
// so a new page is picked up without touching this file — and fails until it
// gets an entry in PAGES below saying what it should show.
//
// Each page must stay where it was opened (no redirect to another page), show
// its own heading (and, where it has one, a section that only it renders),
// finish loading — no "Loading…" left, no "Failed to load" — with no browser
// errors, and on a phone nothing scrolls sideways.

import { allowConsole, type ConsolePattern } from '@pyre/e2e-utils';
import { ADMIN_TOOLS, searchablePages } from '../src/components/admin/adminTools';
import { ADMIN } from './roles';
import { expect, expectNoSidewaysScroll, test, waitForHydration } from './test';

test.use({ storageState: ADMIN.storageState as string });

interface Expected {
  /** The page's h1. null: the page has none (home). */
  heading: string | null;
  /** A section heading only this page renders, present whatever the data. */
  section?: RegExp;
}

/** What each page shows once it has loaded. */
const PAGES: Record<string, Expected> = {
  '/admin': { heading: null },
  '/admin/messages': { heading: 'Messages' },
  '/admin/notifications': { heading: 'Notifications' },
  '/admin/schedule': { heading: 'Staff Schedule' },
  '/admin/schedule-lint': { heading: 'Schedule Lint', section: /^Built-in rules$/i },
  '/admin/water': { heading: 'Cold Tub Water Log', section: /^Log$/i },
  '/admin/inventory': { heading: 'Inventory' },
  '/admin/sops': { heading: 'SOPs' },
  '/admin/ask': { heading: 'Pyre Agent', section: /^Try asking$/i },
  '/admin/incidents': { heading: 'Incident Reports' },
  '/admin/lost-found': { heading: 'Lost & Found' },
  '/admin/guests': { heading: 'Guest Profiles' },
  '/admin/shift-notes': { heading: 'Shift Notes' },
  '/admin/boards': { heading: 'Goals & Boards' },
  '/admin/journeys': { heading: 'Journeys' },
  '/admin/email-templates': { heading: 'Email Templates' },
  '/admin/campaigns': { heading: 'Campaigns' },
  '/admin/partners': { heading: 'Partner Discounts' },
  '/admin/referrals': { heading: 'Referrals', section: /^Discount tiers$/i },
  '/admin/email': { heading: 'Email Performance', section: /^Daily sends$/i },
  '/admin/webhooks': { heading: 'Webhook Executions', section: /^Health$/i },
  '/admin/suggestions': { heading: 'Suggestions' },
  '/admin/business': { heading: 'Business Overview', section: /^Revenue vs total cost$/i },
  '/admin/users': { heading: 'People' },
  '/admin/settings': { heading: 'Settings', section: /^Page visibility$/i },
  '/admin/schedule/calendar': { heading: 'Calendar', section: /^Subscribe to your shifts$/i },
  '/admin/schedule/timesheet': { heading: 'Timesheet', section: /^Stipend hours$/i },
  '/admin/schedule/availability': { heading: 'Availability', section: /^Add time off$/i },
  '/admin/schedule/find-a-time': { heading: 'Find a Time' },
  '/admin/schedule/duties': { heading: 'Shift Duties', section: /^Setup$/i },
  '/admin/schedule/insights': { heading: 'Insights', section: /^Weekly labor cost$/i },
  '/admin/schedule/changes': { heading: 'Change Log' },
  '/admin/sops/runs': { heading: 'Checklist Runs' },
  '/admin/incidents/new': {
    heading: 'Report an Incident',
    section: /^Take care of the incident first\.$/i,
  },
  '/admin/lost-found/new': { heading: 'Log a Found Item', section: /^Photo or video$/i },
  '/admin/campaigns/new': { heading: 'New Campaign' },
  '/admin/campaigns/performance': { heading: 'Campaign Performance' },
  '/admin/campaigns/shortlinks': { heading: 'Short Links', section: /^New short link$/i },
  '/admin/guests/sessions': { heading: "Who's Coming" },
  '/admin/guests/check-ins': { heading: 'Check Ins', section: /^Checked in · \d+$/i },
  '/admin/water/plunges': { heading: 'Plunge Setup' },
  '/admin/guests/fields': { heading: 'Profile Fields' },
  '/admin/boards/tasks': { heading: 'All tasks' },
  '/admin/boards/all-goals': { heading: 'All goals' },
  '/admin/boards/calendar': { heading: 'Calendar' },
  '/admin/boards/goals': { heading: 'Tasks', section: /^To do$/i },
  '/admin/ask/routines': { heading: 'Routines' },
  '/admin/ask/log': { heading: 'Question Log' },
};

/** Browser errors a page is known to log under `astro dev`, with why. */
const EXPECTED_ERRORS: Record<string, ConsolePattern[]> = {
  // The preview iframe is sandboxed, so its images are cross-site requests,
  // which the dev server refuses (403). Vercel serves them.
  '/admin/email-templates': [/status of 403 .*\/email\//],
};

/** A page still fetching, or one whose fetch failed. */
const LOADING = /^Loading\b/;
const LOAD_FAILED = /^(Failed to load|Couldn.t load|Could not load|Something went wrong)/;

const HREFS = [
  ...new Set(
    searchablePages(ADMIN_TOOLS, { isAdmin: true, pages: ADMIN.pages }).map((page) => page.href)
  ),
];

for (const href of HREFS) {
  test.describe(href, () => {
    test.use({ consoleAllowlist: allowConsole(...(EXPECTED_ERRORS[href] ?? [])) });

    test('opens', async ({ page, isMobile }) => {
      const expected = PAGES[href];
      expect(expected, `${href} needs an entry in PAGES (admin-smoke.spec.ts)`).toBeDefined();

      const response = await page.goto(href);
      expect(response?.status()).toBe(200);
      // Still on this page: a redirect to another admin page would pass the
      // rest. (Some pages put their view in the query string, like ?month=.)
      await expect(page).toHaveURL((url) => url.pathname === href);
      await expect(page).toHaveTitle(
        expected.heading ? `${expected.heading} — Pyre Admin` : /^\s*— Pyre Admin$/
      );
      await expect(page.getByRole('heading', { name: 'Unauthorized' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open admin menu' })).toBeVisible();
      if (expected.heading) {
        await expect(
          page.getByRole('heading', { level: 1, name: expected.heading, exact: true })
        ).toBeVisible();
      }
      await waitForHydration(page);
      if (expected.section) {
        await expect(page.getByRole('heading', { name: expected.section })).toBeVisible();
      }

      // Loaded: whatever the page fetches has arrived (a list or its empty
      // state), and nothing failed.
      await expect(page.getByText(LOADING), 'still loading').toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByText(LOAD_FAILED), 'a load failed').toHaveCount(0);
      if (isMobile) await expectNoSidewaysScroll(page);
    });
  });
}
