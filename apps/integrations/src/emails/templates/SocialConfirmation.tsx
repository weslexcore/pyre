import { ASSET_BASE } from '../components/assets';
import { ConfirmationEmail, sampleConfirmationProps } from '../components/ConfirmationEmail';
import type { ConfirmationEmailProps } from '../types';
import { FAQS_BY_TYPE } from '@/lib/email/faq-content';

export function SocialConfirmation(props: ConfirmationEmailProps) {
  return (
    <ConfirmationEmail
      {...props}
      background="lamps"
      preview={`You're booked for ${props.sessionTitle}`}
      headingText="You're in!"
      faqs={FAQS_BY_TYPE['social']}
      headerImageUrl={`${ASSET_BASE}/social-confirmation-header.jpg`}
      intro={`You're all set for ${props.sessionTitle} on ${props.dateLabel} from ${props.timeLabel}. \n\nSocial sessions are a lively, communal sweat - bring a friend or come meet one.`}
    />
  );
}

SocialConfirmation.PreviewProps = {
  ...sampleConfirmationProps,
  sessionImageUrl:
    'https://images.momence.com/h/169530/session-banner/9fec582a-df63-40f2-9754-b4c69f176423.jpeg',
  sessionTitle: 'Social Evening w/ Boy Lichtenstein',
};

export default SocialConfirmation;
