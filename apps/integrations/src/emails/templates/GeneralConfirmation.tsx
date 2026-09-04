import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so the open-hours / default confirmation shows
// in `email dev`.
export function GeneralConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

GeneralConfirmation.PreviewProps = CONFIRMATION_PREVIEWS['open hours'];

export default GeneralConfirmation;
