import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function GuidedConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="You're in!"
      headerImageUrl={`${ASSET_BASE}/guided-confirmation-header.jpg`}
      intro={`You're all set for ${props.sessionTitle} on ${props.dateLabel} from ${props.timeLabel}. \n\nA facilitator will lead you through the experience. Please arrive 10-15 minutes early so you have time to settle in.`}
    />
  );
}

GuidedConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionTitle: 'Signature Guided Class',
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-template-banner/d0db75ba-775b-4335-84f8-2e6a7f28b8a3.webp',
};

export default GuidedConfirmation;
