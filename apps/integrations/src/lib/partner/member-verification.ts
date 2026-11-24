import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import { getDb, type PartnerMemberVerificationRow, type PartnerRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { isUniqueViolation } from '@/lib/http/json';
import {
  type BoughtMembership,
  fetchMemberActivePacks,
  findMemberByEmail,
  getIntroOfferMembershipIds,
} from '@/lib/momence/host-api';
import { isRecurringMembership } from '@/lib/momence/memberships';
import { appOrigin, siteOrigin } from '@/lib/origins';
import { createMemberToken } from './member-token';
import { getPartner, getPartnerCc, getPartnerContacts, lookupPartner } from './registry';

const log = createWebhookLogger('Partner Member Verification');

// Member perks: the reverse direction of verification.ts. A Pyre member who
// wants their perk at a partner asks us to vouch for them; we email the
// partner that their membership is valid.
//
//   requestMemberVerification   landing page /perks form (via /api/partner/member-request)
//                               -> row 'awaiting_confirmation', confirm link emailed to the MEMBER
//   confirmMemberVerification   the member clicks (via /api/partner/member-confirm)
//                               -> live Momence check -> 'verified' + partner emailed,
//                                  or 'not_member' + nothing sent to the partner
//
// The member's click is the point: it proves they own the email, and it is
// their consent before their name goes to a third party. Without it, anyone
// could make us tell a partner that some address belongs to a Pyre member.

const TABLE = 'partner_member_verifications';

/** How long the member's confirm link (and their open row) lives. */
export const MEMBER_LINK_EXPIRY_DAYS = 2;

function confirmUrl(requestId: string): string | null {
  const token = createMemberToken(requestId, MEMBER_LINK_EXPIRY_DAYS);
  if (!token) return null;
  return `${appOrigin()}/api/partner/member-confirm?token=${token}`;
}

function perksUrl(): string {
  return `${siteOrigin()}/perks`;
}

function membershipsUrl(): string {
  return `${siteOrigin()}/unlimited?utm_source=perks&utm_medium=email&utm_campaign=member-perks`;
}

/** A partner takes member-perk requests when it's enabled, has a perk, and has someone to email. */
function perkUnavailableReason(partner: PartnerRow): string | null {
  if (!partner.enabled) return 'partner-disabled';
  if (!partner.member_perk) return 'no-member-perk';
  if (getPartnerContacts(partner).length === 0) return 'partner-not-configured';
  return null;
}

export type MemberRequestResult =
  | { outcome: 'created' }
  | { outcome: 'duplicate' }
  | { outcome: 'unavailable'; reason: string };

export async function requestMemberVerification(params: {
  partnerSlug: string;
  memberEmail: string;
}): Promise<MemberRequestResult> {
  const lookup = await lookupPartner(params.partnerSlug);
  if (lookup.status === 'unavailable')
    return { outcome: 'unavailable', reason: 'storage-unavailable' };
  if (lookup.status === 'unknown') return { outcome: 'unavailable', reason: 'unknown-partner' };
  const partner = lookup.partner;
  const unavailable = perkUnavailableReason(partner);
  if (unavailable) return { outcome: 'unavailable', reason: unavailable };

  const db = getDb();
  if (!db) return { outcome: 'unavailable', reason: 'db-not-configured' };

  const memberEmail = params.memberEmail.trim().toLowerCase();

  // A request still inside its link lifetime re-sends nothing, so the form
  // can't be used to flood someone's inbox. One past it is closed as expired
  // so the fresh request below can open (the partial unique index allows one).
  const { data: open } = await db
    .from(TABLE)
    .select('id, created_at')
    .eq('partner_slug', partner.slug)
    .eq('member_email', memberEmail)
    .eq('status', 'awaiting_confirmation')
    .limit(1);
  if (open && open.length > 0) {
    const ageMs = Date.now() - new Date(open[0].created_at).getTime();
    if (ageMs < MEMBER_LINK_EXPIRY_DAYS * 24 * 60 * 60 * 1000) return { outcome: 'duplicate' };
    await db
      .from(TABLE)
      .update({ status: 'expired' })
      .eq('id', open[0].id)
      .eq('status', 'awaiting_confirmation');
  }

  const { data: inserted, error } = await db
    .from(TABLE)
    .insert({ partner_slug: partner.slug, member_email: memberEmail })
    .select('id')
    .single();
  if (error || !inserted) {
    if (isUniqueViolation(error)) return { outcome: 'duplicate' };
    log.error('Failed to insert member verification request', error);
    return { outcome: 'unavailable', reason: 'db-insert-failed' };
  }

  const url = confirmUrl(inserted.id);
  if (!url) {
    await db.from(TABLE).delete().eq('id', inserted.id);
    return { outcome: 'unavailable', reason: 'link-secret-not-configured' };
  }

  // Sent whether or not the address is a member: what happens next is only
  // revealed to whoever can read this inbox, so the form can't be used to
  // find out who has a Pyre membership.
  const result = await sendTemplate({
    to: memberEmail,
    template: 'partner-member-confirm',
    props: {
      partnerName: partner.name,
      memberPerk: partner.member_perk ?? '',
      confirmUrl: url,
      expiresDays: MEMBER_LINK_EXPIRY_DAYS,
    },
  });
  if (result.status !== 'sent') {
    // Nobody was told, so don't let the open row swallow their retry.
    await db.from(TABLE).delete().eq('id', inserted.id);
    log.error(`Member confirm email not sent to ${memberEmail}: ${result.status}`, result);
    return { outcome: 'unavailable', reason: 'member-email-failed' };
  }

  await captureEvent({
    distinctId: memberEmail,
    event: 'partner_member_verification_requested',
    properties: { partner: partner.slug },
  });

  return { outcome: 'created' };
}

/**
 * The member's current recurring membership, or null. "Member" means what
 * /admin/business counts (lib/momence/memberships.ts): an unfrozen recurring
 * membership, not the intro offer and not a credit pack. With several, one
 * with no end date wins, else the latest end.
 */
async function activeMembership(memberId: number): Promise<BoughtMembership | null> {
  const [packs, introIds] = await Promise.all([
    fetchMemberActivePacks(memberId, { fresh: true }),
    getIntroOfferMembershipIds(),
  ]);
  const now = Date.now();
  const current = packs.filter(
    (p) => isRecurringMembership(p, introIds) && (!p.endDate || new Date(p.endDate).getTime() > now)
  );
  if (current.length === 0) return null;
  return [...current].sort((a, b) => {
    if (!a.endDate) return -1;
    if (!b.endDate) return 1;
    return new Date(b.endDate).getTime() - new Date(a.endDate).getTime();
  })[0];
}

export type MemberConfirmResult =
  | { outcome: 'verified'; partnerName: string; notified: number }
  | { outcome: 'not-member'; partnerName: string }
  | { outcome: 'already-verified'; partnerName: string }
  | { outcome: 'closed'; status: PartnerMemberVerificationRow['status'] }
  | { outcome: 'not-found' }
  | { outcome: 'partner-unavailable' };

/**
 * The member clicked their link: check Momence now, and tell the partner if
 * the membership is valid. Momence is read fresh (never the 20h pack cache),
 * because a membership cancelled this morning must not be vouched for.
 */
export async function confirmMemberVerification(requestId: string): Promise<MemberConfirmResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from(TABLE)
    .select('*')
    .eq('id', requestId)
    .maybeSingle<PartnerMemberVerificationRow>();
  if (!row) return { outcome: 'not-found' };

  const partner = await getPartner(row.partner_slug);
  if (row.status === 'verified') {
    return { outcome: 'already-verified', partnerName: partner?.name ?? row.partner_slug };
  }
  if (row.status !== 'awaiting_confirmation') return { outcome: 'closed', status: row.status };
  // Re-checked at click time: an admin may have switched the partner off, or
  // removed its perk, since the link went out.
  if (!partner || perkUnavailableReason(partner)) return { outcome: 'partner-unavailable' };

  const member = await findMemberByEmail(row.member_email);
  const membership = member ? await activeMembership(member.id) : null;

  const now = new Date().toISOString();

  if (!member || !membership) {
    const { data: updated } = await db
      .from(TABLE)
      .update({ status: 'not_member', confirmed_at: now, momence_member_id: member?.id ?? null })
      .eq('id', row.id)
      .eq('status', 'awaiting_confirmation')
      .select('id');
    if (!updated || updated.length === 0) return reread(row.id, partner.name);

    await captureEvent({
      distinctId: row.member_email,
      event: 'partner_member_verification_not_member',
      properties: { partner: partner.slug, has_momence_record: Boolean(member) },
    });
    return { outcome: 'not-member', partnerName: partner.name };
  }

  const memberName =
    `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || row.member_email;
  const membershipName = membership.membership?.name ?? 'Pyre membership';

  // Claim the row before emailing, so a double click can't email the
  // partner twice. If no contact is reached it goes back to awaiting, and
  // the same link retries.
  const { data: claimed } = await db
    .from(TABLE)
    .update({
      status: 'verified',
      confirmed_at: now,
      momence_member_id: member.id,
      member_name: memberName,
      membership_name: membershipName,
      membership_ends_at: membership.endDate,
    })
    .eq('id', row.id)
    .eq('status', 'awaiting_confirmation')
    .select('id');
  if (!claimed || claimed.length === 0) return reread(row.id, partner.name);

  const contacts = getPartnerContacts(partner);
  const cc = getPartnerCc(partner) ?? undefined;
  let notified = 0;
  for (const email of contacts) {
    try {
      const result = await sendTemplate({
        to: email,
        cc,
        template: 'partner-member-verified',
        props: {
          partnerName: partner.name,
          memberName,
          memberEmail: row.member_email,
          membershipName,
          memberSince: membership.startDate,
          validThrough: membership.endDate,
          memberPerk: partner.member_perk ?? '',
          verifiedAt: now,
        },
      });
      if (result.status === 'sent') notified += 1;
    } catch (error) {
      log.warn(`Member-verified send failed for ${email}`, error);
    }
  }

  if (notified === 0) {
    await db
      .from(TABLE)
      .update({ status: 'awaiting_confirmation', confirmed_at: null })
      .eq('id', row.id)
      .eq('status', 'verified');
    throw new Error(`No ${partner.slug} contact reached for member verification ${row.id}`);
  }

  await db.from(TABLE).update({ notified_count: notified }).eq('id', row.id);

  await captureEvent({
    distinctId: row.member_email,
    event: 'partner_member_verification_sent',
    properties: {
      partner: partner.slug,
      momence_member_id: member.id,
      membership: membershipName,
      notified_count: notified,
    },
  });

  return { outcome: 'verified', partnerName: partner.name, notified };
}

/** Lost a race with another click on the same link: report what that click did. */
async function reread(id: string, partnerName: string): Promise<MemberConfirmResult> {
  const db = getDb();
  const { data } = await db!
    .from(TABLE)
    .select('status')
    .eq('id', id)
    .maybeSingle<Pick<PartnerMemberVerificationRow, 'status'>>();
  if (!data) return { outcome: 'not-found' };
  if (data.status === 'verified') return { outcome: 'already-verified', partnerName };
  if (data.status === 'not_member') return { outcome: 'not-member', partnerName };
  return { outcome: 'closed', status: data.status };
}

/** Links the confirm page offers after its answer. */
export const memberPerkLinks = { perks: perksUrl, memberships: membershipsUrl };
