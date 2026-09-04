import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { CONFIRMATION_PREVIEWS } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so a social confirmation shows in `email dev`.
export function SocialConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

SocialConfirmation.PreviewProps = CONFIRMATION_PREVIEWS.social;

export default SocialConfirmation;
