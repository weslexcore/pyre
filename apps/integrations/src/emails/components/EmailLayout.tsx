import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

// Pyre brand palette (hex — email clients don't support oklch / CSS vars).
export const COLORS = {
  black: '#23221c',
  creme: '#f5f1e9',
  red: '#d15232',
} as const;

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

const footerText = {
  color: 'rgba(35, 34, 28, 0.6)',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0 0 4px',
};

const footerLink = {
  color: COLORS.red,
  textDecoration: 'underline',
};

interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
}

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={wordmark}>Pyre</Text>
          {children}
          <Hr style={hr} />
          <Section>
            <Text style={footerText}>Pyre Sauna · Traditional Finnish sauna &amp; cold plunge</Text>
            <Text style={footerText}>
              Questions? Reply to this email or reach us at{' '}
              <Link href="mailto:hello@pyresauna.com" style={footerLink}>
                hello@pyresauna.com
              </Link>
            </Text>
          </Section>
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
