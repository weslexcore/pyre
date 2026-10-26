import { Button, Link, Text } from '@react-email/components';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { AdminMessageEmailProps } from '../types';

// To everyone a new admin message reaches (/admin/messages), alongside the
// bell notification: the message itself, so it can be read from the inbox,
// and a link to its thread for questions and additions — replies live on the
// dashboard, not in email.
//
// The body is parsed by the same markdown the thread renders (react-markdown
// + GFM, as in SopMarkdown), so whatever formats on the dashboard formats
// here: headings, lists (numbered, nested, task), quotes, code, tables, rules,
// bold/italic/strikethrough and links (relative ones are made absolute by the
// sender). Each element is drawn with inline styles, since email clients
// drop stylesheets.

const linkStyle = { color: COLORS.gold, textDecoration: 'underline' };
const body = { ...text, whiteSpace: 'normal' };
const subheading = { ...heading, fontSize: '18px', lineHeight: '26px', margin: '24px 0 12px' };
const minorHeading = { ...subheading, fontSize: '16px', lineHeight: '24px', margin: '20px 0 8px' };
const list = { ...body, margin: '0 0 16px', paddingLeft: '24px' };
const listItem = { margin: '0 0 6px' };
const muted = { ...text, color: COLORS.creme, opacity: 0.7, fontSize: '14px', lineHeight: '22px' };
const quote = {
  ...body,
  borderLeft: `2px solid ${COLORS.gold}`,
  fontStyle: 'italic',
  margin: '0 0 16px',
  opacity: 0.85,
  paddingLeft: '12px',
};
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const inlineCode = {
  backgroundColor: COLORS.blackSoft,
  borderRadius: '3px',
  fontFamily: mono,
  fontSize: '14px',
  padding: '1px 4px',
};
const codeBlock = {
  backgroundColor: COLORS.blackSoft,
  borderRadius: '4px',
  color: COLORS.creme,
  fontFamily: mono,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 16px',
  overflowX: 'auto' as const,
  padding: '12px',
  whiteSpace: 'pre-wrap' as const,
};
const cell = {
  border: `1px solid ${COLORS.blackSoft}`,
  color: COLORS.creme,
  fontSize: '14px',
  lineHeight: '20px',
  padding: '6px 8px',
  textAlign: 'left' as const,
  verticalAlign: 'top',
};
const rule = { border: 'none', borderTop: `1px solid ${COLORS.blackSoft}`, margin: '24px 0' };

const components: Components = {
  h1: ({ children }) => <Text style={subheading}>{children}</Text>,
  h2: ({ children }) => <Text style={subheading}>{children}</Text>,
  h3: ({ children }) => <Text style={minorHeading}>{children}</Text>,
  h4: ({ children }) => <Text style={minorHeading}>{children}</Text>,
  h5: ({ children }) => <Text style={minorHeading}>{children}</Text>,
  h6: ({ children }) => <Text style={minorHeading}>{children}</Text>,
  p: ({ children }) => <Text style={body}>{children}</Text>,
  ul: ({ children, className }) => (
    <ul
      style={
        className?.includes('contains-task-list')
          ? { ...list, listStyle: 'none', paddingLeft: '4px' }
          : list
      }
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol style={list} start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li style={listItem}>{children}</li>,
  // A checkbox input is stripped or drawn oddly by most mail clients; a box
  // character reads the same everywhere.
  input: ({ checked }) => <span>{checked ? '☑ ' : '☐ '}</span>,
  blockquote: ({ children }) => <div style={quote}>{children}</div>,
  pre: ({ children }) => <pre style={codeBlock}>{children}</pre>,
  // Inside a fence (always more than one source line) the <pre> carries the
  // styling; inline code gets its own.
  code: ({ children, node }) =>
    node?.position?.start.line !== node?.position?.end.line ? (
      <code>{children}</code>
    ) : (
      <code style={inlineCode}>{children}</code>
    ),
  a: ({ children, href }) => (
    <Link href={href} style={linkStyle}>
      {children}
    </Link>
  ),
  table: ({ children }) => (
    <table style={{ borderCollapse: 'collapse', margin: '0 0 16px', width: '100%' }}>
      {children}
    </table>
  ),
  th: ({ children }) => <th style={{ ...cell, fontWeight: 600 }}>{children}</th>,
  td: ({ children }) => <td style={cell}>{children}</td>,
  hr: () => <hr style={rule} />,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      style={{ maxWidth: '100%' }}
    />
  ),
};

export function AdminMessage({ authorName, title, bodyMd, messageUrl }: AdminMessageEmailProps) {
  return (
    <EmailLayout preview={`${authorName}: ${title}`}>
      <Text style={heading}>{title}</Text>
      <Text style={muted}>From {authorName}</Text>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {bodyMd}
      </ReactMarkdown>
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
