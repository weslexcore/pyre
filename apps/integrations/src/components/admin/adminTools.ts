// Single source of truth for the admin tool directory. The /admin dashboard
// cards and the AdminNav menu both render from this list.

export interface AdminTool {
  href: string;
  title: string;
  /** Short label used in the top nav where space is tight. */
  navLabel: string;
  description: string;
}

export const ADMIN_TOOLS: AdminTool[] = [
  {
    href: '/admin/email',
    title: 'Email Performance',
    navLabel: 'Email',
    description: 'Sends, errors, deliverability, and journeys.',
  },
  {
    href: '/admin/email-templates',
    title: 'Email Templates',
    navLabel: 'Templates',
    description: 'Every registered template, rendered with editable props.',
  },
  {
    href: '/admin/utm-assist',
    title: 'UTM Assist',
    navLabel: 'UTM',
    description: 'Build tracked links to the site, a blog post, the events page, or an event.',
  },
  {
    href: '/admin/webhooks',
    title: 'Webhook Executions',
    navLabel: 'Webhooks',
    description: 'Inspect recent webhook events, payloads, traces, and failures.',
  },
  {
    href: '/admin/campaigns',
    title: 'Campaign Performance',
    navLabel: 'Campaigns',
    description: 'Clicks, visits, signups, and bookings per campaign, attributed via PostHog.',
  },
  {
    href: '/admin/water',
    title: 'Cold Tub Water Log',
    navLabel: 'Water',
    description:
      'Log tub test results and chemical doses, with chart-based dosing recommendations.',
  },
];
