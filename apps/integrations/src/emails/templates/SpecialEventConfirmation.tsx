import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so a special-event confirmation shows in `email dev`.
export function SpecialEventConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

SpecialEventConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionType: 'special event',
  sessionTitle: 'Special Event',
};

export default SpecialEventConfirmation;
