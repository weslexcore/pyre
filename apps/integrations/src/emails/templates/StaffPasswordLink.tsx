import { Button, Text } from '@react-email/components';
import { button, EmailLayout, heading, text } from '../components/EmailLayout';
import type { StaffPasswordLinkProps } from '../types';

// To a staff member: a one-time link that opens the admin dashboard's
// set-password page. Sent by the forgot-password form, by the email-first
// login once the Momence cutover is over, and by an admin from /admin/users.

export function StaffPasswordLink({ firstName, actionUrl, isInvite }: StaffPasswordLinkProps) {
  return (
    <EmailLayout
      preview={
        isInvite ? 'Set a password for the Pyre admin tools' : 'Reset your Pyre admin password'
      }
    >
      <Text style={heading}>
        {isInvite ? `Set your password, ${firstName}` : `Reset your password, ${firstName}`}
      </Text>
      <Text style={text}>
        {isInvite
          ? 'The Pyre admin tools now use their own sign-in. Choose a password to finish setting up your account — you will sign in with this email and that password from now on.'
          : 'Someone asked to reset the password for your Pyre admin account. If that was you, choose a new one below.'}
      </Text>
      <Button style={button} href={actionUrl}>
        {isInvite ? 'Set my password' : 'Choose a new password'}
      </Button>
      <Text style={text}>
        The link works once and expires in an hour. If you didn't ask for this, you can ignore this
        email.
      </Text>
    </EmailLayout>
  );
}

StaffPasswordLink.PreviewProps = {
  firstName: 'Omar',
  actionUrl: 'https://pyre-integrations.vercel.app/api/auth/confirm?token_hash=example&type=invite',
  isInvite: true,
} satisfies StaffPasswordLinkProps;

export default StaffPasswordLink;
