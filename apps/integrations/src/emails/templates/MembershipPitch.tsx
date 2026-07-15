import { Button, Hr, Section, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import { emailLink } from '../components/utm';
import type { MembershipPitchProps } from '../types';

// Mirrors apps/landing-page/src/lib/membership.ts - update both together.
const TIERS = [
  {
    name: 'Founding Limited - $119/month',
    detail: '8 credits every month, plus 1 guest pass per month and 10% off other purchases.',
    href: emailLink('https://momence.com/m/633377', 'post-intro-offer', 'founding-limited'),
    buttonColor: COLORS.sky,
    buttonText: 'BECOME A FOUNDING MEMBER',
    buttonTextColor: COLORS.creme,
  },
  {
    name: 'Founding Unlimited - $199/month for life',
    detail:
      "Unlimited access - use 12 credits and you'll save over $250. Includes 4 guest passes per month (up to $180 value) and 10% off other purchases. ",
    href: emailLink('https://momence.com/m/756341', 'post-intro-offer', 'founding-unlimited'),
    buttonColor: COLORS.red,
    buttonText: 'BECOME A FOUNDING MEMBER',
    buttonTextColor: COLORS.creme,
  },
];

const tierName = {
  color: COLORS.creme,
  fontSize: '15px',
  fontWeight: 600 as const,
  margin: '0 0 2px',
};

const tierDetail = {
  color: 'rgba(245, 241, 233, 0.8)',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 14px',
};

export function MembershipPitch({ firstName, unsubscribeUrl }: MembershipPitchProps) {
  return (
    <EmailLayout
      preview="Founding memberships - lock in the rate for life"
      background="clouds"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>Ready to make it official, {firstName}?</Text>
      <Text style={text}>
        If the sauna is becoming part of your rhythm, a founding membership is the best way to keep
        it - locked-in pricing, guest passes to share the heat, and no math before every visit.
      </Text>

      <Section>
        {TIERS.map((tier) => (
          <Section key={tier.name}>
            <Text style={tierName}>{tier.name}</Text>
            <Text style={tierDetail}>{tier.detail}</Text>
            <Button
              href={tier.href}
              style={{ ...button, backgroundColor: tier.buttonColor, color: tier.buttonTextColor }}
            >
              {tier.buttonText}
            </Button>
          </Section>
        ))}
      </Section>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        Founding tiers are limited - once they're gone, they're gone. Reply with any questions and
        we'll help you pick.
      </Text>
      <Text style={text}>Wes + Julien</Text>
    </EmailLayout>
  );
}

MembershipPitch.PreviewProps = {
  firstName: 'Julien',
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies MembershipPitchProps;

export default MembershipPitch;
