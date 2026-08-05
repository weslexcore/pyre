// Single source of truth for the admin tool directory. The /admin dashboard
// cards and the AdminNav menu both render from this list, filtered per user:
// admins see everything, other users see the pages granted to them in
// dashboard_users (managed from /admin/users).

export type AdminToolSection = 'operations' | 'marketing' | 'monitoring';

export interface AdminTool {
  href: string;
  title: string;
  /** Short label used in the top nav where space is tight. */
  navLabel: string;
  description: string;
  section: AdminToolSection;
}

// Display order of the sections on the /admin directory page.
export const ADMIN_TOOL_SECTIONS: { key: AdminToolSection; label: string }[] = [
  { key: 'operations', label: 'Operations' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'monitoring', label: 'Monitoring' },
];

export const ADMIN_TOOLS: AdminTool[] = [
  {
    href: '/admin/schedule',
    title: 'Staff Schedule',
    navLabel: 'Schedule',
    description:
      'Weekly shift board with coverage status, availability-aware assignment, time off, and hours.',
    section: 'operations',
  },
  {
    href: '/admin/water',
    title: 'Cold Tub Water Log',
    navLabel: 'Water',
    description:
      'Log tub test results and chemical doses, with chart-based dosing recommendations.',
    section: 'operations',
  },
  {
    href: '/admin/email-templates',
    title: 'Email Templates',
    navLabel: 'Templates',
    description: 'Every registered template, rendered with editable props.',
    section: 'marketing',
  },
  {
    href: '/admin/utm-assist',
    title: 'UTM Assist',
    navLabel: 'UTM',
    description: 'Build tracked links to the site, a blog post, the events page, or an event.',
    section: 'marketing',
  },
  {
    href: '/admin/campaigns',
    title: 'Campaign Performance',
    navLabel: 'Campaigns',
    description: 'Clicks, visits, signups, and bookings per campaign, attributed via PostHog.',
    section: 'marketing',
  },
  {
    href: '/admin/email',
    title: 'Email Performance',
    navLabel: 'Email',
    description: 'Sends, errors, deliverability, and journeys.',
    section: 'monitoring',
  },
  {
    href: '/admin/webhooks',
    title: 'Webhook Executions',
    navLabel: 'Webhooks',
    description: 'Inspect recent webhook events, payloads, traces, and failures.',
    section: 'monitoring',
  },
];

// Admin-only and never grantable as a page — kept out of ADMIN_TOOLS so it
// can't show up in the page-permission checkboxes.
export const USERS_TOOL: AdminTool = {
  href: '/admin/users',
  title: 'User Access',
  navLabel: 'Users',
  description: 'Grant or revoke dashboard access, admin rights, and per-page permissions.',
  section: 'operations',
};

/** The isAdmin/pages half of DashboardAccess (kept client-bundle-safe here). */
export interface PageAccess {
  isAdmin: boolean;
  pages: string[];
}

// Capability key stored in the same `pages` array as the tool hrefs. A plain
// '/admin/schedule' grant is employee-level: view the board/calendar/hours
// and manage only your own time off. This key (or admin) unlocks the manage
// side — shift/assignment editing, the roster tab, Momence sync, AI drafts,
// and everyone's time off.
export const SCHEDULE_MANAGE = 'schedule:manage';

// The roster tab exposes staff emails and drives assignment matching, so it
// rides on the manage capability rather than the schedule view grant.
const SCHEDULE_STAFF_PATH = '/admin/schedule/staff';

export function hasScheduleManage(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(SCHEDULE_MANAGE);
}

/** Whether this user may view the tool page at `href` (manage implies view). */
export function canViewPage(access: PageAccess, href: string): boolean {
  if (access.isAdmin || access.pages.includes(href)) return true;
  return href === '/admin/schedule' && access.pages.includes(SCHEDULE_MANAGE);
}

/** The tools this user's nav and directory cards should show. */
export function toolsForAccess(access: PageAccess): AdminTool[] {
  if (access.isAdmin) return [...ADMIN_TOOLS, USERS_TOOL];
  return ADMIN_TOOLS.filter((tool) => canViewPage(access, tool.href));
}

/** Whether this user may view the admin page at `pathname`. */
export function canViewPath(access: PageAccess, pathname: string): boolean {
  if (access.isAdmin) return true;
  // The /admin directory itself is fine for anyone with access — it only
  // shows the cards they hold.
  if (pathname === '/admin' || pathname === '/admin/') return true;
  if (pathname === SCHEDULE_STAFF_PATH || pathname.startsWith(`${SCHEDULE_STAFF_PATH}/`)) {
    return hasScheduleManage(access);
  }
  return ADMIN_TOOLS.some(
    (tool) =>
      canViewPage(access, tool.href) &&
      (pathname === tool.href || pathname.startsWith(`${tool.href}/`))
  );
}
