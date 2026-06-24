import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: a sound bath session (sessionType 'sound bath'). Shows the
// yoga-mat "what to bring" FAQ. Copy lives in confirmation-content.ts.
export function SoundBathConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

SoundBathConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionType: 'sound bath',
  sessionTitle: 'Sound Bath // Sauna // Plunge',
};

export default SoundBathConfirmation;
