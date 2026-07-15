import { Button, Hr, Text } from '@react-email/components';
import { button, COLORS, EmailLayout, heading, text } from '../components/EmailLayout';
import type { ReviewRequestProps } from '../types';

export function ReviewRequest({ firstName, reviewUrl, unsubscribeUrl }: ReviewRequestProps) {
  return (
    <EmailLayout
      preview="You know Pyre by now - mind sharing the heat?"
      background="trees"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={heading}>You're one of the regulars now, {firstName}</Text>
      <Text style={text}>
        You've been in the heat with us a few times now, and that means the world to a small,
        founder-run sauna like ours.
      </Text>
      <Text style={text}>
        If Pyre has earned a place in your week, would you take a minute to say so in a Google
        review? It's the single biggest thing that helps new people find us - and it genuinely keeps
        the fire going.
      </Text>

      <Button href={reviewUrl} style={button}>
        Leave a review
      </Button>

      <Hr style={{ borderColor: COLORS.sky, margin: '28px 0 20px' }} />
      <Text style={text}>
        And if anything about your visits hasn't been right, skip the review and reply here instead
        - we want to fix it.
      </Text>
      <Text style={text}>Thank you. Wes + Julien</Text>
    </EmailLayout>
  );
}

ReviewRequest.PreviewProps = {
  firstName: 'Julien',
  reviewUrl: 'https://g.page/r/CbPLgfm6vte6EAI/review',
  unsubscribeUrl: 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview',
} satisfies ReviewRequestProps;

export default ReviewRequest;
