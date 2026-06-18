import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function GeneralConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="You're booked"
      headerImageUrl={`${ASSET_BASE}/confirmation-header.jpg`}
      intro={`You're all set for ${props.sessionTitle} on ${props.dateLabel} from ${props.timeLabel}. \n\nWe've got your session reserved. Arrive anytime during the first hour of your session.`}
    />
  );
}

GeneralConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionTitle: 'Open Hours',
};

export default GeneralConfirmation;
