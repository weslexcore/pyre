import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function GeneralConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="Your session is booked"
      intro="You're all set. We've got your session reserved — arrive a few minutes early so you can get changed and settle in before you begin."
    />
  );
}

GeneralConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionTitle: 'Open Hours',
};

export default GeneralConfirmation;
