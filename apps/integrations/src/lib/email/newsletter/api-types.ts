// What the /api/admin/newsletters routes answer with. Client-bundle-safe.

import type { BlockContent } from '@/lib/email/journeys/schema';

export type NewsletterStatus = 'draft' | 'sending' | 'sent' | 'cancelled';
export type NewsletterList = 'newsletter' | 'volunteer';

export interface NewsletterDto {
  id: string;
  campaign: string;
  list: NewsletterList;
  content: BlockContent;
  status: NewsletterStatus;
  sendAfter: string | null;
  sentCount: number;
  suppressedCount: number;
  failedCount: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceCount {
  /** Everyone on the list. */
  subscribers: number;
  /** Less those on the suppression list: who an issue would go to. */
  reachable: number;
}

export interface NewsletterListResponse {
  issues: NewsletterDto[];
  audience: Record<NewsletterList, AudienceCount>;
  /** The send job does nothing until the 'newsletter' template is live. */
  templateLive: boolean;
}

export interface NewsletterDetailResponse {
  issue: NewsletterDto;
  audience: Record<NewsletterList, AudienceCount>;
  templateLive: boolean;
  /** Sending and cancelling are admin-only. */
  canSend: boolean;
  /** Campaign slugs from the Campaigns tool, for the picker. */
  campaigns: string[];
}

export interface NewsletterPreviewResponse {
  subject: string;
  html: string;
  /** What stops this issue being sent; empty when it can go. */
  problems: string[];
}
