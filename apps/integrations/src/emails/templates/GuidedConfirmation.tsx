import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function GuidedConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="Your guided session is booked"
      headerImageUrl={`${ASSET_BASE}/guided-confirmation-header.jpg`}
      intro="You're all set for your guided session. A facilitator will lead you through the sauna and cold plunge rounds — just arrive a few minutes early so you can settle in."
    />
  );
}

GuidedConfirmation.PreviewProps = {...sampleConfirmationProps, sessionImageUrl: "https://images.momence.com/h/169530/session-template-banner/d0db75ba-775b-4335-84f8-2e6a7f28b8a3.webp"};

export default GuidedConfirmation;
