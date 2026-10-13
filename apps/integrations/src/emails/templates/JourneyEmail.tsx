import { Button, Hr, Img, Link, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import {
  type InlineToken,
  isSafeHref,
  parseInline,
  splitParagraphs,
} from '@/lib/email/journeys/inline-markdown';
import type { EmailBlock } from '@/lib/email/journeys/schema';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import { journeyLink, journeyLinkContent } from '../components/utm';
import type { JourneyEmailProps } from '../types';

// The one template behind every dashboard-built journey email: an ordered list
// of blocks (written in /admin/journeys, merge fields already filled) laid out
// in the standard branded shell. Copy lives in the journey definition, not
// here — this file only decides how each block type looks.

const linkStyle = { color: COLORS.creme, textDecoration: 'underline' };

function Inline({
  tokens,
  campaign,
  stepKey,
}: {
  tokens: InlineToken[];
  campaign: string;
  stepKey?: string;
}): ReactNode {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case 'bold':
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        return <strong key={i}>{t.text}</strong>;
      case 'italic':
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        return <em key={i}>{t.text}</em>;
      case 'link':
        return (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
            key={i}
            href={journeyLink(t.href, campaign, journeyLinkContent(stepKey, t.text, t.href))}
            style={linkStyle}
          >
            {t.text}
          </Link>
        );
      default:
        return t.text;
    }
  });
}

const listItem = { ...text, margin: '0 0 8px', paddingLeft: '4px' };

function Block({
  block,
  campaign,
  stepKey,
}: {
  block: EmailBlock;
  campaign: string;
  stepKey?: string;
}): ReactNode {
  switch (block.type) {
    case 'heading':
      return <Text style={heading}>{block.text}</Text>;
    case 'paragraph':
      return splitParagraphs(block.text).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        <Text key={i} style={text}>
          <Inline tokens={parseInline(p)} campaign={campaign} stepKey={stepKey} />
        </Text>
      ));
    case 'list':
      return (
        <Section style={{ margin: '0 0 16px' }}>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
            <Text key={i} style={listItem}>
              {'• '}
              <Inline tokens={parseInline(item)} campaign={campaign} stepKey={stepKey} />
            </Text>
          ))}
        </Section>
      );
    case 'button':
      if (!block.label || !isSafeHref(block.url)) return null;
      return (
        <Button
          href={journeyLink(block.url, campaign, journeyLinkContent(stepKey, block.label))}
          style={button}
        >
          {block.label}
        </Button>
      );
    case 'divider':
      return <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />;
    case 'image': {
      if (!isSafeHref(block.src)) return null;
      const img = (
        <Img
          src={block.src}
          alt={block.alt}
          width="100%"
          style={{ borderRadius: '8px', margin: '0 0 20px', maxWidth: '100%' }}
        />
      );
      return block.href && isSafeHref(block.href) ? (
        <Link
          href={journeyLink(
            block.href,
            campaign,
            journeyLinkContent(stepKey, block.alt || 'image')
          )}
        >
          {img}
        </Link>
      ) : (
        img
      );
    }
    case 'signoff':
      return <Text style={text}>{block.text}</Text>;
  }
}

export function JourneyEmail({
  preview,
  background,
  blocks,
  campaign,
  stepKey,
  unsubscribeUrl,
}: JourneyEmailProps) {
  return (
    <EmailLayout preview={preview} background={background} unsubscribeUrl={unsubscribeUrl}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        <Block key={i} block={block} campaign={campaign} stepKey={stepKey} />
      ))}
    </EmailLayout>
  );
}

JourneyEmail.PreviewProps = {
  firstName: 'Julien',
  subject: 'How was your first session?',
  preview: 'Your second credit is waiting.',
  background: 'trees',
  campaign: 'preview',
  blocks: [
    { type: 'heading', text: 'How was it, Julien?' },
    {
      type: 'paragraph',
      text: 'We hope your first session left you **clear-headed** and a little bit invincible.\n\nYour second credit is already on your account.',
    },
    { type: 'button', label: 'Book your next session', url: 'https://pyresauna.com/events' },
    { type: 'divider' },
    { type: 'signoff', text: 'Wes + Julien' },
  ],
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies JourneyEmailProps;

export default JourneyEmail;
