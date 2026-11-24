import { EmailLayout } from '../components/EmailLayout';
import type { NewsletterEmailProps } from '../types';
import { EmailBlocks } from './JourneyEmail';

// The monthly newsletter, sent as a Resend broadcast: one HTML body for the
// whole segment. It is built from the same blocks as a journey email, with its
// links tagged utm_source=newsletter. The footer always carries an
// unsubscribe link; for a broadcast that link is Resend's
// {{{RESEND_UNSUBSCRIBE_URL}}} placeholder, filled in per recipient (see
// lib/email/newsletter/render.ts). Not in the sendTemplate() registry: it never
// goes out one recipient at a time.

export function NewsletterEmail({
  preview,
  background,
  blocks,
  campaign,
  unsubscribeUrl,
}: NewsletterEmailProps) {
  return (
    <EmailLayout
      preview={preview}
      background={background}
      unsubscribeUrl={unsubscribeUrl}
      utmSource="newsletter"
    >
      <EmailBlocks blocks={blocks} campaign={campaign} utmSource="newsletter" />
    </EmailLayout>
  );
}

NewsletterEmail.PreviewProps = {
  preview: 'Three new evening sessions, and a winter series.',
  background: 'clouds',
  campaign: 'newsletter-2026-12',
  blocks: [
    { type: 'heading', text: 'December at Pyre' },
    {
      type: 'paragraph',
      text: 'Hi there,\n\nThe nights are long and the sauna is **hot**. Here is what is on this month.',
    },
    { type: 'button', label: 'See the schedule', url: 'https://pyresauna.com/events' },
    { type: 'divider' },
    { type: 'signoff', text: 'Wes + Julien' },
  ],
  unsubscribeUrl: '{{{RESEND_UNSUBSCRIBE_URL}}}',
} satisfies NewsletterEmailProps;

export default NewsletterEmail;
