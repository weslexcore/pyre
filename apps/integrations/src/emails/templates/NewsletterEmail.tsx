import { EmailLayout } from '../components/EmailLayout';
import type { NewsletterEmailProps } from '../types';
import { EmailBlocks } from './JourneyEmail';

// The monthly newsletter, written on /admin/newsletters. It is built from the
// same blocks as a journey email, with its links tagged utm_source=newsletter.
// The footer always carries an unsubscribe link. The send job renders it once
// with placeholders and fills in each person's name and their own signed
// unsubscribe link (see lib/email/newsletter/render.ts).

export function NewsletterEmail({
  preview,
  background,
  logo,
  blocks,
  campaign,
  unsubscribeUrl,
}: NewsletterEmailProps) {
  return (
    <EmailLayout
      preview={preview}
      background={background}
      logo={logo}
      unsubscribeUrl={unsubscribeUrl}
      utmSource="newsletter"
    >
      <EmailBlocks blocks={blocks} campaign={campaign} utmSource="newsletter" />
    </EmailLayout>
  );
}

NewsletterEmail.PreviewProps = {
  subject: 'December at Pyre',
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
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies NewsletterEmailProps;

export default NewsletterEmail;
