// Shared bits for the /admin/newsletters islands. Client-bundle-safe.

import type { NewsletterDto, NewsletterList } from '@/lib/email/newsletter/api-types';

export const LIST_LABELS: Record<NewsletterList, string> = {
  newsletter: 'Everyone on the mailing list',
  volunteer: 'Volunteers only',
};

export type StatusTone = 'on' | 'off' | 'test' | 'warn';

/** A short status label and the badge tone it shows in. */
export function statusLabel(
  issue: NewsletterDto,
  now = Date.now()
): { text: string; tone: StatusTone } {
  switch (issue.status) {
    case 'draft':
      return { text: 'Draft', tone: 'off' };
    case 'sending':
      if (issue.sendAfter && new Date(issue.sendAfter).getTime() > now && !issue.startedAt) {
        return { text: 'Scheduled', tone: 'test' };
      }
      return { text: 'Sending', tone: 'test' };
    case 'sent':
      return { text: 'Sent', tone: 'on' };
    case 'cancelled':
      return { text: 'Stopped', tone: 'warn' };
  }
}

export function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
