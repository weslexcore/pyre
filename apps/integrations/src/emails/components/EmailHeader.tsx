import { Img, Link, Section } from '@react-email/components';
import { ASSET_BASE } from './assets';

const header = {
  margin: '0 0 32px',
};

const logoStyle = {
  width: '100px',
  height: 'auto',
  margin: '0 auto',
};

// An uploaded logo gets a little more room, since it may be a wide wordmark.
const ownLogoStyle = {
  width: '160px',
  maxWidth: '100%',
  height: 'auto',
  margin: '0 auto',
};

/**
 * Pyre's logo, linked to the site. `logo` is 'pyre' (or unset), 'none' for no
 * header at all, or an uploaded image's address (checked on save, see
 * emailLogoSchema).
 */
export function EmailHeader({ logo }: { logo?: string }) {
  if (logo === 'none') return null;
  const own = logo !== undefined && logo !== 'pyre';
  return (
    <Section style={header}>
      <Link href="https://pyresauna.com">
        {own ? (
          <Img src={logo} width="160" alt="Pyre" style={ownLogoStyle} />
        ) : (
          <Img
            src={`${ASSET_BASE}/logo-header-creme.png`}
            width="120"
            alt="Pyre"
            style={logoStyle}
          />
        )}
      </Link>
    </Section>
  );
}
