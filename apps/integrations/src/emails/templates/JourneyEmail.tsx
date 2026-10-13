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
import { emailLink } from '../components/utm';
import type { JourneyEmailProps } from '../types';

// The one template behind every dashboard-built journey email: an ordered list
// of blocks (written in /admin/journeys, merge fields already filled) laid out
// in the standard branded shell. Copy lives in the journey definition, not
// here — this file only decides how each block type looks.

// Our own and Momence checkout links get UTM tags so web-side attribution
// joins with the journey events; third-party links (Google reviews, maps) are
// left exactly as written.
const TAGGED_HOSTS = ['pyresauna.com', 'momence.com'];

function trackedHref(href: string, campaign: string, content: string): string {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '');
    if (!TAGGED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return href;
    return emailLink(href, campaign, content);
  } catch {
    return href;
  }
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'link'
  );
}

const linkStyle = { color: COLORS.creme, textDecoration: 'underline' };

function Inline({ tokens, campaign }: { tokens: InlineToken[]; campaign: string }): ReactNode {
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
          // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
          <Link key={i} href={trackedHref(t.href, campaign, slug(t.text))} style={linkStyle}>
            {t.text}
          </Link>
        );
      default:
        return t.text;
    }
  });
}

const listItem = { ...text, margin: '0 0 8px', paddingLeft: '4px' };

function Block({ block, campaign }: { block: EmailBlock; campaign: string }): ReactNode {
  switch (block.type) {
    case 'heading':
      return <Text style={heading}>{block.text}</Text>;
    case 'paragraph':
      return splitParagraphs(block.text).map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        <Text key={i} style={text}>
          <Inline tokens={parseInline(p)} campaign={campaign} />
        </Text>
      ));
    case 'list':
      return (
        <Section style={{ margin: '0 0 16px' }}>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
            <Text key={i} style={listItem}>
              {'• '}
              <Inline tokens={parseInline(item)} campaign={campaign} />
            </Text>
          ))}
        </Section>
      );
    case 'button':
      if (!block.label || !isSafeHref(block.url)) return null;
      return (
        <Button href={trackedHref(block.url, campaign, slug(block.label))} style={button}>
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
        <Link href={trackedHref(block.href, campaign, 'image')}>{img}</Link>
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
  unsubscribeUrl,
}: JourneyEmailProps) {
  return (
    <EmailLayout preview={preview} background={background} unsubscribeUrl={unsubscribeUrl}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        <Block key={i} block={block} campaign={campaign} />
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
