import { Img, Link, Section } from '@react-email/components';
import { ASSET_BASE } from './assets';

const header = {
  margin: '0 0 32px',
};

const logo = {
  width: '180px',
  height: 'auto',
};

export function EmailHeader() {
  return (
    <Section style={header}>
      <Link href="https://pyresauna.com">
        <Img src={`${ASSET_BASE}/logo-header.png`} width="180" alt="Pyre" style={logo} />
      </Link>
    </Section>
  );
}
