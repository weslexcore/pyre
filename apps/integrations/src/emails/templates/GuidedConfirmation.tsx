import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function GuidedConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="Your guided session is booked"
      intro="You're all set for your guided session. A facilitator will lead you through the sauna and cold plunge rounds — just arrive a few minutes early so you can settle in."
    />
  );
}

GuidedConfirmation.PreviewProps = sampleConfirmationProps;

export default GuidedConfirmation;
