import { render } from '@react-email/components';
import { createElement } from 'react';
import { MAILING_ADDRESS } from '@/emails/components/EmailFooter';
import { NewsletterEmail } from '@/emails/templates/NewsletterEmail';
import type { BlockContent } from '@/lib/email/journeys/schema';
import {
  fillPlaceholders,
  hasPlaceholders,
  newsletterProblems,
  toTemplateContent,
  UNSUBSCRIBE_PLACEHOLDER,
} from './content';

/** One issue rendered for everyone, with each person's details left as placeholders. */
export interface NewsletterTemplate {
  subject: string;
  html: string;
  text: string;
}

/** One person's copy. */
export interface NewsletterCopy {
  subject: string;
  html: string;
  text: string;
}

export interface Recipient {
  firstName?: string | null;
  /** Their signed /api/unsubscribe link (buildUnsubscribeUrl). */
  unsubscribeUrl: string;
}

export class NewsletterContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Newsletter can't be sent: ${problems.join(' ')}`);
  }
}

/**
 * Renders an issue once, for every recipient. Refuses content that would go
 * out wrong (see newsletterProblems), and a render whose footer lost its
 * unsubscribe link or postal address: both are legal requirements, so a
 * template change that drops one stops the send rather than the compliance.
 */
export async function renderNewsletter(
  content: BlockContent,
  campaign: string,
  /** The editor preview renders a draft with problems too, and lists them beside it. */
  { allowProblems = false }: { allowProblems?: boolean } = {}
): Promise<NewsletterTemplate> {
  const problems = newsletterProblems(content);
  if (problems.length > 0 && !allowProblems) throw new NewsletterContentError(problems);

  const body = toTemplateContent(content);
  const element = createElement(NewsletterEmail, {
    preview: body.preview,
    background: body.background,
    blocks: body.blocks,
    campaign,
    unsubscribeUrl: UNSUBSCRIBE_PLACEHOLDER,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);

  const missing = [
    !html.includes(UNSUBSCRIBE_PLACEHOLDER) && 'unsubscribe link (HTML)',
    !text.includes(UNSUBSCRIBE_PLACEHOLDER) && 'unsubscribe link (plain text)',
    !html.includes(MAILING_ADDRESS) && 'postal address',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Newsletter footer is missing its ${missing.join(', ')}`);
  }

  return { subject: body.subject, html, text };
}

/**
 * One person's copy of a rendered issue: the send, the editor preview and
 * test sends all go through here, so what staff see is what people get.
 */
export function personalize(template: NewsletterTemplate, recipient: Recipient): NewsletterCopy {
  const details = {
    firstName: recipient.firstName ?? undefined,
    unsubscribeUrl: recipient.unsubscribeUrl,
  };
  const copy = {
    subject: fillPlaceholders(template.subject, details, false),
    html: fillPlaceholders(template.html, details, true),
    text: fillPlaceholders(template.text, details, false),
  };
  if (hasPlaceholders(copy.subject) || hasPlaceholders(copy.html) || hasPlaceholders(copy.text)) {
    throw new Error('Newsletter copy still has an unfilled placeholder');
  }
  return copy;
}
