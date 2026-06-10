import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components';
import type { ReactNode } from 'react';
import { COLORS } from './colors';
import { EmailFooter } from './EmailFooter';

// Re-exported so existing templates importing COLORS from here keep working.
export { COLORS };

const main = {
  backgroundColor: COLORS.creme,
  color: COLORS.black,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
};

const container = {
  backgroundColor: COLORS.creme,
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px 24px 48px',
};

const wordmark = {
  color: COLORS.red,
  fontSize: '28px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  margin: '0 0 24px',
  textTransform: 'uppercase' as const,
};

const hr = {
  borderColor: 'rgba(35, 34, 28, 0.15)',
  margin: '32px 0 20px',
};

interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function EmailLayout({
  preview,
  children,
  unsubscribeUrl,
  preferencesUrl,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={wordmark}>Pyre</Text>
          {children}
          <Hr style={hr} />
          <EmailFooter unsubscribeUrl={unsubscribeUrl} preferencesUrl={preferencesUrl} />
        </Container>
      </Body>
    </Html>
  );
}

// Shared inline styles reused across templates.
export const text = {
  color: COLORS.black,
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px',
};

export const heading = {
  color: COLORS.black,
  fontSize: '22px',
  fontWeight: 700,
  lineHeight: '30px',
  margin: '0 0 16px',
};

export const button = {
  backgroundColor: COLORS.red,
  borderRadius: '6px',
  color: COLORS.creme,
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 24px',
  textDecoration: 'none',
};
