import { Button, Hr, Section, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { CreditPackPitchProps } from '../types';

// Pack lineup mirrors the landing page (apps/landing-page/src/lib/sessions.ts) —
// update both together when pricing changes.
const PACKS = [
  {
    name: 'Duo // 2 credits',
    price: '$45',
    detail: 'Come for a special event, stay for 2 hours, or come back again.',
    href: 'https://momence.com/m/702636',
  },
  {
    name: 'Circle // 4 credits',
    price: '$85',
    detail: 'Build momentum — come back often or bring your circle.',
    href: 'https://momence.com/m/630915',
  },
  {
    name: 'Ritual // 8 credits',
    price: '$165',
    detail: 'Our best value — designed for consistency, connection, and shared experiences.',
    href: 'https://momence.com/m/630916',
  },
];

const packName = {
  color: COLORS.creme,
  fontSize: '15px',
  fontWeight: 600 as const,
  margin: '0 0 2px',
};

const packDetail = {
  color: 'rgba(245, 241, 233, 0.8)',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 14px',
};

export function CreditPackPitch({ firstName, unsubscribeUrl }: CreditPackPitchProps) {
  return (
    <EmailLayout
      preview="Credit packs — the easiest way to make the sauna a habit"
      background="lamps"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>Make it a ritual, {firstName}</Text>
      <Text style={text}>
        The benefits of sauna and cold plunge compound with consistency — better sleep, faster
        recovery, a calmer baseline. Credit packs make coming back easy (and cheaper than single
        sessions).
      </Text>
      <Text style={text}>All packs can be shared with friends and family.</Text>

      <Section>
        {PACKS.map((pack) => (
          <Section key={pack.name}>
            <Text style={packName}>
              {pack.name} — {pack.price}
            </Text>
            <Text style={packDetail}>{pack.detail}</Text>
          </Section>
        ))}
      </Section>

      <Button href="https://momence.com/m/630916" style={button}>
        Get the Ritual pack
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        Not sure which fits? Reply and tell us how often you want to come — we'll point you to the
        right one.
      </Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

CreditPackPitch.PreviewProps = {
  firstName: 'Julien',
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies CreditPackPitchProps;

export default CreditPackPitch;
