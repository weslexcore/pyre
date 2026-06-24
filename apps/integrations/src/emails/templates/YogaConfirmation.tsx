import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: a yoga session (sessionType 'yoga'). Shows the yoga-mat
// "what to bring" FAQ. Copy lives in confirmation-content.ts.
export function YogaConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

YogaConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionType: 'yoga',
  sessionTitle: 'Yoga // Sauna // Plunge',
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-banner/32f8ce0d-8f97-4ac6-a013-d600c9a73d7d.jpeg',
};

export default YogaConfirmation;
