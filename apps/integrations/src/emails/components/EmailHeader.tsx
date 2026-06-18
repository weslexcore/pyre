import { Img, Link, Section } from '@react-email/components';
import { ASSET_BASE } from './assets';

const header = {
  margin: '0 0 32px',
};

const logo = {
  width: '100px',
  height: 'auto',
};

export function EmailHeader() {
  return (
    <Section style={header}>
      <Link href="https://pyresauna.com">
        <Img src={`${ASSET_BASE}/single-pine-tree-white.png`} width="120" alt="Pyre" style={logo} />
      </Link>
    </Section>
  );
}
