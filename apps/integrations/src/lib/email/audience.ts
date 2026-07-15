import { getResend } from './resend';

// Resend contact sync — the marketing-contact counterpart to the Mailchimp
// upsert in @pyre/webhook-core. Called from the same webhook/backfill flows so
// both lists stay in lockstep.
//
// Resend's model (post "Audiences -> Segments" migration): contacts are
// account-global — no audience id needed. RESEND_SEGMENT_ID is optional; when
// set, new contacts are also attached to that segment (useful as the broadcast
// target for the monthly digest).
//
// IMPORTANT: we never write `unsubscribed` here. Resend owns that flag per
// contact (set via broadcast footers, our /api/unsubscribe route, or the
// suppression propagator) and a member-update webhook must not resubscribe
// someone who opted out.

export interface ResendContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

export type ResendUpsertResult =
  | { status: 'created' | 'updated'; id?: string }
  | { status: 'skipped'; reason: string };

export async function upsertResendContact(
  contact: ResendContactInput
): Promise<ResendUpsertResult> {
  const resend = getResend();

  if (!resend) {
    console.warn(`[Resend Audience] Not configured — skipping contact upsert for ${contact.email}`);
    return { status: 'skipped', reason: 'resend-not-configured' };
  }

  const segmentId = import.meta.env.RESEND_SEGMENT_ID;

  const created = await resend.contacts.create({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    ...(segmentId && { segments: [{ id: segmentId }] }),
  });

  if (!created.error) {
    return { status: 'created', id: created.data?.id };
  }

  // Contact already exists (or create otherwise rejected) — fall through to an
  // update by email so name changes still propagate.
  const updated = await resend.contacts.update({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
  });

  if (updated.error) {
    throw new Error(
      `Resend contact upsert failed for ${contact.email}: create=${created.error.message} update=${updated.error.message}`
    );
  }

  return { status: 'updated', id: updated.data?.id };
}

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
