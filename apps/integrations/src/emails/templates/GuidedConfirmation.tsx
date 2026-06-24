import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

// Preview-only. All copy lives in confirmation-content.ts (keyed by sessionType);
// this just supplies sample data so a guided confirmation shows in `email dev`.
export function GuidedConfirmation(props: ConfirmationEmailProps) {
  return <ConfirmationEmail {...props} />;
}

GuidedConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionType: 'guided',
  sessionTitle: 'Signature Guided Class',
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-template-banner/d0db75ba-775b-4335-84f8-2e6a7f28b8a3.webp',
};

export default GuidedConfirmation;
