import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: a yoga session (sessionType 'yoga'). Shows the yoga-mat
// "what to bring" FAQ. Copy lives in confirmation-content.ts.
export function YogaConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

YogaConfirmation.PreviewProps = CONFIRMATION_PREVIEWS.yoga;

export default YogaConfirmation;
