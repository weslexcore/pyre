import { ConfirmationEmail } from '../components/ConfirmationEmail';
import { UNRESOLVED_PREVIEW } from '../preview-sessions';
import type { ConfirmationEmailProps } from '../types';

// Preview-only: what sends when the Momence events feed can't resolve the
// booking (it has already dropped off the upcoming feed, or the API is down).
// The email degrades to the essentials — no time, arrival line or calendar
// links — so it's worth being able to look at.
export function UnresolvedConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

UnresolvedConfirmation.PreviewProps = UNRESOLVED_PREVIEW;

export default UnresolvedConfirmation;
