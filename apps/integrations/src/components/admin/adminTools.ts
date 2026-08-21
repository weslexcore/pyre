// Single source of truth for the admin tool directory. The /admin dashboard
// cards and the AdminNav menu both render from this list, filtered per user:
// admins see everything, other users see the pages granted to them in
// the staff table (managed from /admin/users).

export type AdminToolSection = 'operations' | 'community' | 'marketing' | 'monitoring' | 'admin';

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
  { key: 'community', label: 'Community + Collaborations' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'admin', label: 'Admin' },
];

// Shift Notes is a normal grantable page with one twist: everyone flagged
// is_shift_lead on the roster gets it without an explicit grant (the implicit
// grant lives in lib/auth/access — leading shifts is what the page is for).
// The checkbox on /admin/users still works for giving it to anyone else.
export const SHIFT_NOTES_HREF = '/admin/shift-notes';

export const ADMIN_TOOLS: AdminTool[] = [
  {
    href: '/admin/schedule',
    title: 'Staff Schedule',
    navLabel: 'Schedule',
    description:
      'Weekly shift board with coverage status, availability-aware assignment, time off, and hours.',
    section: 'admin',
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
    href: '/admin/sops',
    title: 'SOPs',
    navLabel: 'SOPs',
    description:
      'Standard operating procedures — markdown checklists and guides with per-document access levels and full version history.',
    section: 'operations',
  },
  {
    href: '/admin/incidents',
    title: 'Incident Reports',
    navLabel: 'Incidents',
    description:
      'Report a slip, burn, or near miss from your phone, and the log of everything that has happened — with photos, follow-up, and a full audit trail.',
    section: 'operations',
  },
  {
    href: SHIFT_NOTES_HREF,
    title: 'Shift Notes',
    navLabel: 'Shift Notes',
    description:
      'How each shift went, from the person leading it — details worth handing off, feedback, and photos or video backing what they saw.',
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
    href: '/admin/partners',
    title: 'Partner Discounts',
    navLabel: 'Partners',
    description:
      'Partner registry, verifier contacts, discount levers, and the membership verification queue.',
    section: 'community',
  },
  {
    href: '/admin/referrals',
    title: 'Referrals',
    navLabel: 'Referrals',
    description:
      'Referrer codes for members and partners, the redemption queue, reward ledger, and discount tiers.',
    section: 'community',
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
// can't show up in the page-permission checkboxes. Revenue and labor cost
// together are the most sensitive numbers in the building.
export const BUSINESS_TOOL: AdminTool = {
  href: '/admin/business',
  title: 'Business Overview',
  navLabel: 'Business',
  description:
    'Revenue, labor cost vs revenue, memberships, and attendance — Momence reports joined with the schedule.',
  section: 'admin',
};

// Admin-only and never grantable as a page — kept out of ADMIN_TOOLS so it
// can't show up in the page-permission checkboxes.
export const USERS_TOOL: AdminTool = {
  href: '/admin/users',
  title: 'People',
  navLabel: 'People',
  description:
    'Everyone at Pyre: dashboard access and permissions, founders, and who is available to schedule.',
  section: 'admin',
};

/** The isAdmin/pages half of DashboardAccess (kept client-bundle-safe here). */
export interface PageAccess {
  isAdmin: boolean;
  pages: string[];
}

// Capability key stored in the same `pages` array as the tool hrefs. A plain
// '/admin/schedule' grant is employee-level: view the board/calendar/hours
// and manage only your own time off. This key (or admin) unlocks the manage
// side — shift/assignment editing, Momence sync, AI drafts, staff emails on
// the board, and everyone's time off. The roster itself (who exists, founder,
// available to schedule) is edited on the admin-only /admin/users page.
export const SCHEDULE_MANAGE = 'schedule:manage';

export function hasScheduleManage(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(SCHEDULE_MANAGE);
}

// Same split for partners: a plain '/admin/partners' grant is read-only —
// browse the registry and the verification queue. This key (or admin) unlocks
// editing partners and acting on requests (confirm/deny/resend/revoke), all of
// which either email a third party or change someone's Momence tags.
export const PARTNERS_MANAGE = 'partners:manage';

export function hasPartnersManage(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(PARTNERS_MANAGE);
}

// Same split for referrals: a plain '/admin/referrals' grant is read-only.
// This key (or admin) unlocks creating/editing referrers and tiers and
// revoking redemptions/rewards — all of which change Momence tags.
export const REFERRALS_MANAGE = 'referrals:manage';

export function hasReferralsManage(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(REFERRALS_MANAGE);
}

// Same split for incidents, and the most consequential of the four. A plain
// '/admin/incidents' grant is reporter-level: file a report, and read back
// the ones you were part of — because incident reports carry guest names,
// contact details, and injury descriptions, and a bathhouse attendant needs
// to file one, not to browse everyone else's. This key (or admin) unlocks the
// whole log: reviewing, editing, resolving, and the trends every report rolls
// up into.
export const INCIDENTS_MANAGE = 'incidents:manage';

export function hasIncidentsManage(access: PageAccess): boolean {
  return access.isAdmin || access.pages.includes(INCIDENTS_MANAGE);
}

/** Manage capabilities that imply view access to the page they govern. */
const MANAGE_IMPLIES_VIEW: Record<string, string> = {
  '/admin/schedule': SCHEDULE_MANAGE,
  '/admin/partners': PARTNERS_MANAGE,
  '/admin/referrals': REFERRALS_MANAGE,
  '/admin/incidents': INCIDENTS_MANAGE,
};

/** Whether this user may view the tool page at `href` (manage implies view). */
export function canViewPage(access: PageAccess, href: string): boolean {
  if (access.isAdmin || access.pages.includes(href)) return true;
  const manageKey = MANAGE_IMPLIES_VIEW[href];
  return manageKey !== undefined && access.pages.includes(manageKey);
}

/** The tools this user's nav and directory cards should show. */
export function toolsForAccess(access: PageAccess): AdminTool[] {
  if (access.isAdmin) return [...ADMIN_TOOLS, USERS_TOOL, BUSINESS_TOOL];
  return ADMIN_TOOLS.filter((tool) => canViewPage(access, tool.href));
}

/** Whether this user may view the admin page at `pathname`. */
export function canViewPath(access: PageAccess, pathname: string): boolean {
  if (access.isAdmin) return true;
  // The /admin directory itself is fine for anyone with access — it only
  // shows the cards they hold.
  if (pathname === '/admin' || pathname === '/admin/') return true;
  return ADMIN_TOOLS.some(
    (tool) =>
      canViewPage(access, tool.href) &&
      (pathname === tool.href || pathname.startsWith(`${tool.href}/`))
  );
}
