import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so the open-hours / default confirmation shows
// in `email dev`.
export function GeneralConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

GeneralConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionType: 'open hours',
  sessionTitle: 'Open Hours',
};

export default GeneralConfirmation;
