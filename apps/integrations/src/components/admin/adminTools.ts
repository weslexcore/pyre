// Single source of truth for the admin tool directory. The /admin dashboard
// cards and the AdminNav menu both render from this list.

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
