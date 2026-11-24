import { Body, Container, Head, Html, Preview, Section } from '@react-email/components';
import type { ReactNode } from 'react';
import { ASSET_BASE } from './assets';
import { COLORS } from './colors';
import { EmailFooter } from './EmailFooter';
import { EmailHeader } from './EmailHeader';
import type { EmailUtmSource } from './utm';

// Re-exported so existing templates importing COLORS from here keep working.
export { COLORS };

/** A preset photo, or the address of an uploaded image (journey and newsletter emails). */
export type EmailBackground = 'clouds' | 'trees' | 'lamps' | (string & {});

const BACKGROUND_IMAGES = new Map<string, string>([
  ['clouds', 'bg-clouds.jpg'],
  ['trees', 'bg-trees.jpg'],
  ['lamps', 'bg-lamps.png'],
]);

const main = {
  backgroundColor: COLORS.black,
  color: COLORS.creme,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: 0,
};

// Background image lives on a full-width Section (not Body) because Gmail can
// strip body styles. Clients without background-image support (desktop
// Outlook) fall back to the solid color.
// An uploaded image is used as is; its address was checked on save
// (emailBackgroundSchema), so it can't break out of url().
const backgroundUrl = (background: EmailBackground) => {
  const preset = BACKGROUND_IMAGES.get(background);
  return preset ? `${ASSET_BASE}/${preset}` : background;
};

const backdrop = (background: EmailBackground) => ({
  backgroundColor: COLORS.black,
  backgroundImage: `url(${backgroundUrl(background)})`,
  backgroundSize: 'cover',
  backgroundPosition: 'center top',
  backgroundRepeat: 'no-repeat',
  padding: '40px 12px',
});

const container = {
  backgroundColor: COLORS.black,
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '560px',
  // No horizontal padding here: it's re-applied per content block (bodyInset,
  // footer) so the footer's pine-tree band can bleed edge to edge. Gmail strips
  // negative margins, so breaking *out* of a padded container is not reliable.
  padding: '32px 0 48px',
};

// Horizontal inset for body content; keeps text/images off the card edges while
// the full-width tree band runs flush.
const bodyInset = {
  padding: '0 24px',
};

interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
  background?: EmailBackground;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  /** utm_source for the footer's own links. */
  utmSource?: EmailUtmSource;
}

export function EmailLayout({
  preview,
  children,
  background = 'clouds',
  unsubscribeUrl,
  preferencesUrl,
  utmSource,
}: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Section style={backdrop(background)}>
          <Container style={container}>
            <EmailHeader />
            <Section style={bodyInset}>{children}</Section>
            <EmailFooter
              unsubscribeUrl={unsubscribeUrl}
              preferencesUrl={preferencesUrl}
              utmSource={utmSource}
            />
          </Container>
        </Section>
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
  whiteSpace: 'pre-line',
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
  margin: '0 0 24px',
};
