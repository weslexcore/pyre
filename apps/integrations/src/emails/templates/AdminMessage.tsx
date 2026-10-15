import { Button, Link, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { parseInline, splitParagraphs } from '@/lib/email/journeys/inline-markdown';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { AdminMessageEmailProps } from '../types';

// To everyone a new admin message reaches (/admin/messages), alongside the
// bell notification: the message itself, so it can be read from the inbox,
// and a link to its thread for questions and additions — replies live on the
// dashboard, not in email.
//
// The body is the same markdown the thread renders, drawn here in the subset
// an email can carry: paragraphs, headings, list items, **bold**, *italic*,
// and links (relative ones are made absolute by the sender). Anything else
// reads as literal text.

const linkStyle = { color: COLORS.creme, textDecoration: 'underline' };
const subheading = { ...heading, fontSize: '18px', lineHeight: '26px', margin: '0 0 12px' };
const listItem = { ...text, margin: '0 0 8px', paddingLeft: '4px' };
const muted = { ...text, color: COLORS.creme, opacity: 0.7, fontSize: '14px', lineHeight: '22px' };

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

function Inline({ line }: { line: string }): ReactNode {
  return parseInline(line).map((t, i) => {
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
          <Link key={i} href={t.href} style={linkStyle}>
            {t.text}
          </Link>
        );
      default:
        return t.text;
    }
  });
}

/** One blank-line-separated block: a heading, list items, or a paragraph. */
function Block({ block }: { block: string }): ReactNode {
  const lines = block.split('\n');
  const headingMatch = lines.length === 1 ? HEADING_RE.exec(lines[0]) : null;
  if (headingMatch) {
    return (
      <Text style={subheading}>
        <Inline line={headingMatch[1]} />
      </Text>
    );
  }
  if (lines.every((line) => BULLET_RE.test(line))) {
    return lines.map((line, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
      <Text key={i} style={listItem}>
        {'• '}
        <Inline line={BULLET_RE.exec(line)?.[1] ?? line} />
      </Text>
    ));
  }
  // `text` keeps single newlines as line breaks (white-space: pre-line).
  return (
    <Text style={text}>
      <Inline line={block} />
    </Text>
  );
}

export function AdminMessage({ authorName, title, bodyMd, messageUrl }: AdminMessageEmailProps) {
  return (
    <EmailLayout preview={`${authorName}: ${title}`}>
      <Text style={heading}>{title}</Text>
      <Text style={muted}>From {authorName}</Text>
      {splitParagraphs(bodyMd).map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static render, order never changes
        <Block key={i} block={block} />
      ))}
      <Text style={text}>
        Questions, or something to add? Reply in the message thread on the dashboard.
      </Text>
      <Button style={button} href={messageUrl}>
        Open the message
      </Button>
    </EmailLayout>
  );
}

AdminMessage.PreviewProps = {
  authorName: 'Wes',
  title: 'New towel routine starting Monday',
  bodyMd:
    "Starting Monday we're moving to the new towel routine.\n\n## What changes\n\n- Fold towels in thirds, logo out\n- Restock the cold plunge rack every **two hours**\n\nThe full steps are in the [towels SOP](https://pyre-integrations.vercel.app/admin/sops).",
  messageUrl:
    'https://pyre-integrations.vercel.app/admin/messages/00000000-0000-0000-0000-000000000000',
} satisfies AdminMessageEmailProps;

export default AdminMessage;
