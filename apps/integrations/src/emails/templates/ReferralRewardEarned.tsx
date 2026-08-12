import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ReferralRewardEarnedProps } from '../types';

// To the referrer when a friend they referred completes their first booking.
// The reward copy matches how it was delivered: a free session credit already
// on their account, a front-desk comp (members with no credit pack), or the
// automatic next-session discount (drop-in payers).

const REWARD_COPY: Record<ReferralRewardEarnedProps['rewardKind'], { body: string; cta: string }> =
  {
    credit: {
      body: "As a thank-you, we've added a free session credit to your account — it's already there, ready to book with.",
      cta: 'Book your free session',
    },
    manual: {
      body: 'As a thank-you, your next session is on us — just mention your referral reward at the front desk next time you\u2019re in.',
      cta: 'See the schedule',
    },
    discount: {
      body: 'As a thank-you, a discount on your next session is now live on your account. Book with this email address and it comes off automatically at checkout — no code needed.',
      cta: 'Book your next session',
    },
  };

export function ReferralRewardEarned({
  firstName,
  friendFirstName,
  rewardKind,
  bookUrl,
}: ReferralRewardEarnedProps) {
  const copy = REWARD_COPY[rewardKind];
  return (
    <EmailLayout preview="Your referral reward at Pyre is live" background="trees">
      <Text style={heading}>Nice one, {firstName}</Text>
      <Text style={text}>
        {friendFirstName} just booked their first session at Pyre — thanks to you.
      </Text>
      <Text style={text}>{copy.body}</Text>
      <Button href={bookUrl} style={button}>
        {copy.cta}
      </Button>
      <Text style={text}>Keep them coming. Wes + Julien</Text>
    </EmailLayout>
  );
}

ReferralRewardEarned.PreviewProps = {
  firstName: 'Wes',
  friendFirstName: 'Jane',
  rewardKind: 'credit',
  bookUrl: 'https://pyresauna.com/events?utm_source=referral-reward&utm_medium=referral',
} satisfies ReferralRewardEarnedProps;

export default ReferralRewardEarned;
