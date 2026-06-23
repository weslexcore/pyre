import { Img, Link, Section, Text } from '@react-email/components';
import { ASSET_BASE } from './assets';
import { COLORS } from './colors';

const INSTAGRAM_URL = 'https://instagram.com/pyre_sauna';
const WEBSITE_URL = 'https://pyresauna.com';
const MAILING_ADDRESS = '1000 Westover Hills Blvd. Richmond, VA 23225 USA';

const footer = {
  textAlign: 'center' as const,
  // The Container has no horizontal padding (EmailLayout), so each content
  // block re-applies its own inset.
  padding: '0 24px',
};

// Full-bleed strip: the Container drops its horizontal padding so a plain
// width:100% band runs edge to edge across the card. Avoids negative margins,
// which Gmail strips.
const treeBand = {
  width: '100%',
  height: '96px',
  backgroundImage: `url(${ASSET_BASE}/pine-tree-repeat-creme.png)`,
  backgroundRepeat: 'repeat-x',
  backgroundPosition: 'center',
  backgroundSize: 'auto 96px',
  margin: '40px 0 32px',
};

const iconBadge = {
  display: 'inline-block',
  margin: '0 6px 24px',
};

const footerText = {
  color: COLORS.creme,
  fontSize: '10px',
  lineHeight: '20px',
  margin: '0 0 6px',
  fontFamily: 'monospace',
};

const spacerText = {
  ...footerText,
  margin: '20px 0 6px',
};

const footerLink = {
  color: COLORS.creme,
  textDecoration: 'underline',
};

interface EmailFooterProps {
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function EmailFooter({ unsubscribeUrl, preferencesUrl }: EmailFooterProps) {
  return (
    <>
      <Section role="presentation" style={treeBand} />
      <Section style={footer}>
        <Link href={INSTAGRAM_URL}>
          <Img
            src={`${ASSET_BASE}/instagram-badge-creme.png`}
            width="40"
            height="40"
            alt="Instagram"
            style={iconBadge}
          />
        </Link>
        <Link href={WEBSITE_URL}>
          <Img
            src={`${ASSET_BASE}/website-badge-creme.png`}
            width="40"
            height="40"
            alt="Website"
            style={iconBadge}
          />
        </Link>
        <Text style={footerText}>Pyre LLC, {MAILING_ADDRESS}</Text>
        {(unsubscribeUrl || preferencesUrl) && (
          <>
            <Text style={spacerText}>Want to change how you receive these emails?</Text>
            <Text style={footerText}>
              You can{' '}
              {preferencesUrl && (
                <Link href={preferencesUrl} style={footerLink}>
                  update your preferences
                </Link>
              )}
              {preferencesUrl && unsubscribeUrl && ' or '}
              {unsubscribeUrl && (
                <Link href={unsubscribeUrl} style={footerLink}>
                  unsubscribe
                </Link>
              )}
            </Text>
          </>
        )}
      </Section>
    </>
  );
}
