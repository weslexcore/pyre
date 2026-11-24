import { render } from '@react-email/components';
import { createElement } from 'react';
import { MAILING_ADDRESS } from '@/emails/components/EmailFooter';
import { NewsletterEmail } from '@/emails/templates/NewsletterEmail';
import type { BlockContent } from '@/lib/email/journeys/schema';
import {
  newsletterProblems,
  personalContent,
  RESEND_UNSUBSCRIBE_PLACEHOLDER,
  toBroadcastContent,
} from './content';

export interface RenderedNewsletter {
  subject: string;
  preview: string;
  html: string;
  text: string;
}

export type NewsletterRenderMode =
  /** The broadcast itself: Resend fills names and the unsubscribe link. */
  | { kind: 'broadcast' }
  /** One person's copy: the editor preview, or a test send to staff. */
  | { kind: 'personal'; firstName?: string; unsubscribeUrl: string };

export class NewsletterContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Newsletter can't be sent: ${problems.join(' ')}`);
  }
}

/**
 * Renders a newsletter to HTML and plain text. Refuses content that would go
 * out wrong (see newsletterProblems), and a broadcast whose footer lost its
 * unsubscribe link or postal address: both are legal requirements, so a
 * template change that drops one stops the send rather than the compliance.
 */
export async function renderNewsletter(
  content: BlockContent,
  campaign: string,
  mode: NewsletterRenderMode
): Promise<RenderedNewsletter> {
  const problems = newsletterProblems(content);
  if (problems.length > 0) throw new NewsletterContentError(problems);

  const body =
    mode.kind === 'broadcast'
      ? toBroadcastContent(content)
      : personalContent(content, mode.firstName);
  const unsubscribeUrl =
    mode.kind === 'broadcast' ? RESEND_UNSUBSCRIBE_PLACEHOLDER : mode.unsubscribeUrl;

  const element = createElement(NewsletterEmail, {
    preview: body.preview,
    background: body.background,
    blocks: body.blocks,
    campaign,
    unsubscribeUrl,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  if (mode.kind === 'broadcast') {
    const missing = [
      !html.includes(RESEND_UNSUBSCRIBE_PLACEHOLDER) && 'unsubscribe link (HTML)',
      !text.includes(RESEND_UNSUBSCRIBE_PLACEHOLDER) && 'unsubscribe link (plain text)',
      !html.includes(MAILING_ADDRESS) && 'postal address',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`Newsletter footer is missing its ${missing.join(', ')}`);
    }
  }

  return { subject: body.subject, preview: body.preview, html, text };
}
