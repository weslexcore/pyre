import { Img, Link, Section, Text } from '@react-email/components';
import { COLORS } from './colors';

// Footer images are served by the landing page deployment (email clients
// can't load local assets, and import.meta.env is unavailable in the
// react-email preview server, so this stays a plain constant).
const ASSET_BASE = 'https://pyresauna.com/email';

const INSTAGRAM_URL = 'https://instagram.com/pyre_sauna';
const MAILING_ADDRESS = 'Pyre Sauna 1000 Westover Hills Blvd. Richmond, VA 23225 USA';

const footer = {
  textAlign: 'center' as const,
};

const instagramBadge = {
  margin: '0 auto 24px',
};

const logoMark = {
  margin: '0 auto 28px',
};

const footerText = {
  color: COLORS.black,
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0 0 6px',
};

const copyrightText = {
  ...footerText,
  fontStyle: 'italic' as const,
};

const spacerText = {
  ...footerText,
  margin: '20px 0 6px',
};

const footerLink = {
  color: COLORS.black,
  textDecoration: 'underline',
};

interface EmailFooterProps {
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function EmailFooter({ unsubscribeUrl, preferencesUrl }: EmailFooterProps) {
  return (
    <Section style={footer}>
      <Link href={INSTAGRAM_URL}>
        <Img
          src={`${ASSET_BASE}/instagram-badge.png`}
          width="40"
          height="40"
          alt="Instagram"
          style={instagramBadge}
        />
      </Link>
      <Img src={`${ASSET_BASE}/logo-mark.png`} width="120" alt="Pyre" style={logoMark} />
      <Text style={copyrightText}>
        Copyright (C) {new Date().getFullYear()} Pyre Sauna. All rights reserved.
      </Text>
      <Text style={footerText}>
        You are receiving this email because you opted in via our website.
      </Text>
      <Text style={spacerText}>Our mailing address is:</Text>
      <Text style={footerText}>{MAILING_ADDRESS}</Text>
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
  );
}
