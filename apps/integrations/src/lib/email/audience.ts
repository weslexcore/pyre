import { getResend } from './resend';

// What is left of the Resend contact sync. The mailing list now lives in
// Supabase (newsletter_subscribers, lib/mailing-list/subscribe.ts) and the
// newsletter is sent one email per person, so nothing creates Resend contacts
// any more. The contacts created before that still exist, and an unsubscribe
// is still mirrored onto them, so Resend never shows one of them subscribed.

// Mark a contact unsubscribed in Resend (downstream mirror of the suppression
// list — see lib/email/suppression.ts). Best-effort: missing contacts are fine.
export async function markResendContactUnsubscribed(email: string): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const { error } = await resend.contacts.update({ email, unsubscribed: true });
  if (error) {
    console.warn(`[Resend Audience] Could not mark ${email} unsubscribed: ${error.message}`);
  }
}
