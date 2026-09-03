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
  /**
   * Other names people call this tool, for the global search (cmd+K). The
   * title and description already match; list the words that don't appear in
   * either — "cold plunge" for the water log, say.
   */
  keywords?: string[];
}

// Display order of the sections on the /admin directory page.
export const ADMIN_TOOL_SECTIONS: { key: AdminToolSection; label: string }[] = [
  { key: 'operations', label: 'Operations' },
  { key: 'community', label: 'Community + Collaborations' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'admin', label: 'Admin' },
];

// Shift Notes is a normal grantable page with one twist: everyone active on
// the roster gets it without an explicit grant (the implicit grant lives in
// lib/auth/access — writing up your own shift is everyone's job). The
// checkbox on /admin/users still works for giving it to anyone else, e.g.
// someone off the schedule. Access to the page is not access to the log:
// only admins read everyone's notes, everyone else reads their own.
export const SHIFT_NOTES_HREF = '/admin/shift-notes';

export const ADMIN_TOOLS: AdminTool[] = [
  {
    href: '/admin/schedule',
    title: 'Staff Schedule',
    navLabel: 'Schedule',
    description:
      'Weekly shift board with coverage status, availability-aware assignment, time off, and hours.',
    section: 'admin',
    keywords: ['shifts', 'roster', 'week', 'who is working'],
  },
  {
    href: '/admin/water',
    title: 'Cold Tub Water Log',
    navLabel: 'Water',
    description:
      'Log tub test results and chemical doses, with chart-based dosing recommendations.',
    section: 'operations',
    keywords: ['cold plunge', 'plunge', 'logs', 'water tests', 'chemistry', 'chlorine', 'ph'],
  },
  {
    href: '/admin/sops',
    title: 'SOPs',
    navLabel: 'SOPs',
    description:
      'Standard operating procedures — markdown checklists and guides with per-document access levels and full version history.',
    section: 'operations',
    keywords: ['procedures', 'checklists', 'guides', 'docs', 'library'],
  },
  {
    href: '/admin/ask',
    title: 'Ask a Question',
    navLabel: 'Ask',
    keywords: ['assistant', 'knowledge', 'help', 'ai'],
    description:
      'Ask the knowledge assistant anything about how we run the sauna. It answers from the SOPs, shift notes, water log, and incident reports you can see, with links to its sources.',
    section: 'operations',
  },
  {
    href: '/admin/incidents',
    title: 'Incident Reports',
    navLabel: 'Incidents',
    keywords: ['injury', 'accident', 'near miss', 'slip', 'burn', 'safety'],
    description:
      'Report a slip, burn, or near miss from your phone, and the log of everything that has happened — with photos, follow-up, and a full audit trail.',
    section: 'operations',
  },
  {
    href: SHIFT_NOTES_HREF,
    title: 'Shift Notes',
    navLabel: 'Shift Notes',
    keywords: ['handoff', 'log', 'journal'],
    description:
      'How your shift went — details worth handing off, feedback, and photos or video backing what you saw. Admins read every note; everyone else reads their own.',
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
  keywords: ['revenue', 'finance', 'money', 'costs', 'memberships', 'attendance'],
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
  keywords: ['users', 'staff', 'roster', 'permissions', 'access'],
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

/**
 * A page the global search (cmd+K) can open. Tools and their sub-pages share
 * this shape; `hint` says where the page lives (its section, or its parent
 * tool) so a sub-page named "Hours" reads as the schedule's hours.
 */
export interface SearchPage {
  href: string;
  title: string;
  hint: string;
  /** The tool's description (top-level pages only) — matched, never shown. */
  description?: string;
  keywords: string[];
}

interface AdminSubpage {
  href: string;
  title: string;
  /** The tool href this page lives under; viewing the tool is viewing this. */
  parent: string;
  keywords?: string[];
  /** Admin-only pages nested under a grantable tool (their pages self-check). */
  adminOnly?: boolean;
}

// Pages nested under a tool. They inherit the tool's view grant (AdminLayout's
// prefix rule), except the admin-only ones, whose pages redirect non-admins.
const ADMIN_SUBPAGES: AdminSubpage[] = [
  { href: '/admin/schedule/calendar', title: 'Calendar', parent: '/admin/schedule' },
  {
    href: '/admin/schedule/hours',
    title: 'Hours',
    parent: '/admin/schedule',
    keywords: ['pay', 'timesheet', 'hours worked'],
  },
  {
    href: '/admin/schedule/time-off',
    title: 'Time Off',
    parent: '/admin/schedule',
    keywords: ['vacation', 'pto', 'unavailable'],
  },
  { href: '/admin/schedule/availability', title: 'Availability', parent: '/admin/schedule' },
  {
    href: '/admin/schedule/insights',
    title: 'Schedule Insights',
    parent: '/admin/schedule',
    adminOnly: true,
  },
  {
    href: '/admin/schedule/changes',
    title: 'Schedule Changes',
    parent: '/admin/schedule',
    keywords: ['audit', 'history', 'log'],
    adminOnly: true,
  },
  {
    href: '/admin/sops/runs',
    title: 'Checklist Runs',
    parent: '/admin/sops',
    keywords: ['completed', 'history', 'who ran'],
  },
  {
    href: '/admin/incidents/new',
    title: 'Report an Incident',
    parent: '/admin/incidents',
    keywords: ['file', 'new incident', 'injury', 'accident'],
  },
  {
    href: '/admin/ask/log',
    title: 'Question Log',
    parent: '/admin/ask',
    keywords: ['audit', 'history', 'assistant'],
    adminOnly: true,
  },
];

/**
 * Every page this user may open, as the global search lists them: the tools
 * they hold (already filtered by toolsForAccess), the dashboard itself, and
 * the sub-pages under those tools.
 */
export function searchablePages(tools: AdminTool[], isAdmin: boolean): SearchPage[] {
  const sectionLabel = new Map(ADMIN_TOOL_SECTIONS.map((s) => [s.key, s.label]));
  const byHref = new Map(tools.map((tool) => [tool.href, tool]));
  const pages: SearchPage[] = [
    { href: '/admin', title: 'Home', hint: 'Dashboard', keywords: ['dashboard', 'index', 'tools'] },
    ...tools.map((tool) => ({
      href: tool.href,
      title: tool.title,
      hint: sectionLabel.get(tool.section) ?? '',
      description: tool.description,
      keywords: [tool.navLabel, ...(tool.keywords ?? [])],
    })),
  ];
  for (const sub of ADMIN_SUBPAGES) {
    const parent = byHref.get(sub.parent);
    if (!parent) continue;
    if (sub.adminOnly && !isAdmin) continue;
    pages.push({
      href: sub.href,
      title: sub.title,
      hint: parent.title,
      keywords: sub.keywords ?? [],
    });
  }
  return pages;
}
