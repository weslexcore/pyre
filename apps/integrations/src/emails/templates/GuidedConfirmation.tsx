import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so a guided confirmation shows in `email dev`.
export function GuidedConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

GuidedConfirmation.PreviewProps = CONFIRMATION_PREVIEWS.guided;

export default GuidedConfirmation;
