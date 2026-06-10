import { Body, Container, Head, Html, Preview } from '@react-email/components';
import type { ReactNode } from 'react';
import { COLORS } from './colors';
import { EmailFooter } from './EmailFooter';
import { EmailHeader } from './EmailHeader';

// Re-exported so existing templates importing COLORS from here keep working.
export { COLORS };

const main = {
  backgroundColor: COLORS.black,
  color: COLORS.creme,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
};

const container = {
  backgroundColor: COLORS.black,
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px 24px 48px',
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
          <EmailHeader />
          {children}
          <EmailFooter unsubscribeUrl={unsubscribeUrl} preferencesUrl={preferencesUrl} />
        </Container>
      </Body>
    </Html>
  );
}

// Shared inline styles reused across templates.
export const text = {
  color: COLORS.creme,
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px',
};

export const heading = {
  color: COLORS.creme,
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
