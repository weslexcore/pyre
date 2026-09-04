import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: a sound bath session (sessionType 'sound bath'). Shows the
// yoga-mat "what to bring" FAQ. Copy lives in confirmation-content.ts.
export function SoundBathConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

SoundBathConfirmation.PreviewProps = CONFIRMATION_PREVIEWS['sound bath'];

export default SoundBathConfirmation;
