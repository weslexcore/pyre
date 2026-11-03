import { Button, Hr, Img, Link, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSafeHref } from '@/lib/email/journeys/inline-markdown';
import { BUTTON_COLORS, type EmailBlockInput } from '@/lib/email/journeys/schema';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import { journeyLink, journeyLinkContent } from '../components/utm';
import type { JourneyEmailProps } from '../types';

// The one template behind every dashboard-built journey email: an ordered list
// of blocks (written in /admin/journeys, merge fields already filled) laid out
// in the standard branded shell. Copy lives in the journey definition, not
// here — this file only decides how each block type looks.
//
// Text is Markdown (react-markdown + GFM, as in AdminMessage): headings, lists,
// quotes, code, rules, bold/italic/strikethrough, links and images. Each
// element is drawn with inline styles, since email clients drop stylesheets.
// Raw HTML is never rendered, links and images must be absolute https/mailto,
// and every link is tagged for the journey and step it came from.

const linkStyle = { color: COLORS.creme, textDecoration: 'underline' };
const body = { ...text, whiteSpace: 'normal' };
const subheading = { ...heading, fontSize: '18px', lineHeight: '26px', margin: '24px 0 12px' };
const minorHeading = { ...subheading, fontSize: '16px', lineHeight: '24px', margin: '20px 0 8px' };
const list = { ...body, margin: '0 0 16px', paddingLeft: '24px' };
const listItem = { margin: '0 0 8px' };
const quote = {
  ...body,
  borderLeft: `2px solid ${COLORS.sky}`,
  fontStyle: 'italic',
  margin: '0 0 16px',
  opacity: 0.85,
  paddingLeft: '12px',
};
const inlineCode = {
  backgroundColor: COLORS.blackSoft,
  borderRadius: '3px',
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  fontSize: '14px',
  padding: '1px 4px',
};

type HastNode = { value?: unknown; children?: unknown[] };

/** The visible text of a Markdown element, for naming a link in utm_content. */
function plainText(node: HastNode | undefined): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map((c) => plainText(c as HastNode)).join('');
}

function markdownComponents(campaign: string, stepKey?: string): Components {
  return {
    h1: ({ children }) => <Text style={heading}>{children}</Text>,
    h2: ({ children }) => <Text style={subheading}>{children}</Text>,
    h3: ({ children }) => <Text style={minorHeading}>{children}</Text>,
    h4: ({ children }) => <Text style={minorHeading}>{children}</Text>,
    h5: ({ children }) => <Text style={minorHeading}>{children}</Text>,
    h6: ({ children }) => <Text style={minorHeading}>{children}</Text>,
    // pre-line keeps a single line break the author typed, as plain text did.
    p: ({ children }) => <Text style={text}>{children}</Text>,
    ul: ({ children }) => <ul style={list}>{children}</ul>,
    ol: ({ children, start }) => (
      <ol style={list} start={start}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li style={listItem}>{children}</li>,
    // A checkbox input is stripped or drawn oddly by most mail clients.
    input: ({ checked }) => <span>{checked ? '☑ ' : '☐ '}</span>,
    blockquote: ({ children }) => <div style={quote}>{children}</div>,
    code: ({ children }) => <code style={inlineCode}>{children}</code>,
    hr: () => <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />,
    a: ({ children, href, node }) => {
      if (!href || !isSafeHref(href)) return <>{children}</>;
      const label = plainText(node) || href;
      return (
        <Link
          href={journeyLink(href, campaign, journeyLinkContent(stepKey, label, href))}
          style={linkStyle}
        >
          {children}
        </Link>
      );
    },
    img: ({ src, alt }) =>
      typeof src === 'string' && isSafeHref(src) ? (
        <Img
          src={src}
          alt={alt ?? ''}
          width="100%"
          style={{ borderRadius: '8px', margin: '0 0 20px', maxWidth: '100%' }}
        />
      ) : null,
  };
}

function Markdown({
  source,
  campaign,
  stepKey,
  inline = false,
}: {
  source: string;
  campaign: string;
  stepKey?: string;
  /** Inside an existing line (a bullet, the sign-off): no paragraph wrapper. */
  inline?: boolean;
}): ReactNode {
  const components = markdownComponents(campaign, stepKey);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inline ? { ...components, p: ({ children }) => <>{children}</> } : components}
    >
      {source}
    </ReactMarkdown>
  );
}

function Block({
  block,
  campaign,
  stepKey,
}: {
  block: EmailBlockInput;
  campaign: string;
  stepKey?: string;
}): ReactNode {
  switch (block.type) {
    case 'heading':
      return <Text style={heading}>{block.text}</Text>;
    case 'paragraph':
      return <Markdown source={block.text} campaign={campaign} stepKey={stepKey} />;
    case 'list':
      return (
        <ul style={list}>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
            <li key={i} style={listItem}>
              <Markdown source={item} campaign={campaign} stepKey={stepKey} inline />
            </li>
          ))}
        </ul>
      );
    case 'button': {
      if (!block.label || !isSafeHref(block.url)) return null;
      const href = journeyLink(block.url, campaign, journeyLinkContent(stepKey, block.label));
      const color = BUTTON_COLORS[block.color ?? 'red'] ?? BUTTON_COLORS.red;
      if (block.style === 'link') {
        return (
          <Text style={{ ...text, margin: '0 0 24px' }}>
            <Link
              href={href}
              style={{ color: color.hex, fontWeight: 600, textDecoration: 'underline' }}
            >
              {block.label}
            </Link>
          </Text>
        );
      }
      const width = block.fullWidth
        ? {
            display: 'block',
            width: '100%',
            textAlign: 'center' as const,
            boxSizing: 'border-box' as const,
          }
        : {};
      const look =
        block.style === 'outline'
          ? { backgroundColor: 'transparent', color: color.hex, border: `2px solid ${color.hex}` }
          : { backgroundColor: color.hex, color: color.text };
      return (
        <Button href={href} style={{ ...button, ...look, ...width }}>
          {block.label}
        </Button>
      );
    }
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
      return (
        <Text style={text}>
          <Markdown source={block.text} campaign={campaign} stepKey={stepKey} inline />
        </Text>
      );
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
