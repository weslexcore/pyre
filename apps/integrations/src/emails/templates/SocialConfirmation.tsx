import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function SocialConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="Your social session is booked"
      headerImageUrl={`${ASSET_BASE}/social-confirmation-header.jpg`}
      intro="You're in! Social sessions are a lively, communal sweat — bring a friend or come meet some. Arrive a few minutes early to get changed and grab a spot."
    />
  );
}

SocialConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionImageUrl: "https://images.momence.com/h/169530/session-banner/9fec582a-df63-40f2-9754-b4c69f176423.jpeg",
  sessionTitle: 'Social Sauna + DJ',
};

export default SocialConfirmation;
