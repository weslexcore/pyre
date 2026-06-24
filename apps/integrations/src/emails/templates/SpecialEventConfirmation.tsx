import { FAQS_BY_TYPE } from '@/lib/email/faq-content';
import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';

export function SpecialEventConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      preview={`You're booked for ${props.sessionTitle}`}
      headingText={"You're in!"}
      headerImageUrl={`${ASSET_BASE}/confirmation-header.jpg`}
      faqs={FAQS_BY_TYPE['special_event']}
      intro={`You're all set for ${props.sessionTitle} on ${props.dateLabel} from ${props.timeLabel}. \n\nArrive 10-15 minutes early to check in, get changed, and settle in before things kick off.`}
    />
  );
}

SpecialEventConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionTitle: 'Sound Bath // Sauna // Plunge',
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-banner/32f8ce0d-8f97-4ac6-a013-d600c9a73d7d.jpeg',
};

export default SpecialEventConfirmation;
