import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function SocialConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="Your social session is booked"
      intro="You're in! Social sessions are a lively, communal sweat — bring a friend or come meet some. Arrive a few minutes early to get changed and grab a spot."
    />
  );
}

SocialConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionTitle: 'Social Sauna + DJ',
};

export default SocialConfirmation;
