import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so a social confirmation shows in `email dev`.
export function SocialConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

SocialConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  timeLabel: '6:00 PM – 8:00 PM EDT',
  arrivalLabel: 'Arrive anytime between 6:00 PM and 7:00 PM to check in and get changed.',
  sessionType: 'social',
  sessionTitle: 'Social Evening w/ Boy Lichtenstein',
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-banner/9fec582a-df63-40f2-9754-b4c69f176423.jpeg',
};

export default SocialConfirmation;
