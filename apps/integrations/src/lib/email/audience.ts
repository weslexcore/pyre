import { getResend } from './resend';
import { lookupSuppression } from './suppression';

// Resend contact sync — the marketing-contact counterpart to the Mailchimp
// upsert in @pyre/webhook-core. Called from the same webhook/backfill flows so
// both lists stay in lockstep.
//
// Resend's model (post "Audiences -> Segments" migration): contacts are
// account-global — no audience id needed. RESEND_SEGMENT_ID is optional; when
// set, new contacts are also attached to that segment (useful as the broadcast
// target for the monthly digest).
//
// IMPORTANT: we never write `unsubscribed: false` here. A member-update webhook
// must not resubscribe someone who opted out. We DO write `unsubscribed: true`
// for anyone on the suppression list: broadcasts only check Resend's own flag,
// so a contact created (or re-created) after its suppression would otherwise
// get the newsletter. When the suppression list can't be read the contact is
// not written at all; creating it subscribed could mail an opted-out person,
// and creating it unsubscribed would echo back through the contact webhook as
// a real unsubscribe.

export interface ResendContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

export type ResendUpsertResult =
  | { status: 'created' | 'updated'; id?: string; suppressed: boolean }
  | { status: 'skipped'; reason: string };

export interface ResendUpsertOptions {
  /** Segments to join beyond RESEND_SEGMENT_ID (e.g. the volunteer list). */
  extraSegmentIds?: string[];
  /**
   * Also add a contact that already exists to the segments. A sign-up form
   * wants this (a booker who joins the mailing list must land in the
   * newsletter segment); the Momence member sync doesn't, so its updates stay
   * one call.
   */
  joinSegments?: boolean;
}

export async function upsertResendContact(
  contact: ResendContactInput,
  { extraSegmentIds = [], joinSegments = false }: ResendUpsertOptions = {}
): Promise<ResendUpsertResult> {
  const resend = getResend();

  if (!resend) {
    console.warn(`[Resend Audience] Not configured — skipping contact upsert for ${contact.email}`);
    return { status: 'skipped', reason: 'resend-not-configured' };
  }

  const suppressed = await lookupSuppression(contact.email);
  if (suppressed === null) {
    console.warn(
      `[Resend Audience] Suppression list unavailable — skipping contact upsert for ${contact.email}`
    );
    return { status: 'skipped', reason: 'suppression-unknown' };
  }

  const segmentIds = [import.meta.env.RESEND_SEGMENT_ID, ...extraSegmentIds].filter(
    (id): id is string => Boolean(id)
  );

  const created = await resend.contacts.create({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    ...(suppressed && { unsubscribed: true }),
    ...(segmentIds.length > 0 && { segments: segmentIds.map((id) => ({ id })) }),
  });

  if (!created.error) {
    return { status: 'created', id: created.data?.id, suppressed };
  }

  // Contact already exists (or create otherwise rejected) — fall through to an
  // update by email so name changes still propagate.
  const updated = await resend.contacts.update({
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    ...(suppressed && { unsubscribed: true }),
  });

  if (updated.error) {
    throw new Error(
      `Resend contact upsert failed for ${contact.email}: create=${created.error.message} update=${updated.error.message}`
    );
  }

  if (joinSegments) {
    // Already a member answers with an error too; neither is worth failing
    // the sign-up over, and the newsletter import script repairs the segment.
    for (const segmentId of segmentIds) {
      const { error } = await resend.contacts.segments.add({ email: contact.email, segmentId });
      if (error) {
        console.warn(
          `[Resend Audience] Could not add ${contact.email} to segment ${segmentId}: ${error.message}`
        );
      }
    }
  }

  return { status: 'updated', id: updated.data?.id, suppressed };
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
