import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { LAST_SLOT_PREVIEW } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: the last drop-in session of the day. Last entry is an hour
// before closing, so the usual "anytime in the first hour" window collapses to
// a single arrival time.
export function LastSlotConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

LastSlotConfirmation.PreviewProps = LAST_SLOT_PREVIEW;

export default LastSlotConfirmation;
