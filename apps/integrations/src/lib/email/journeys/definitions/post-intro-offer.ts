import { getIntroOfferMembershipIds } from '@/lib/momence/host-api';
import { isMemberFirstBooking } from '@/lib/webhooks/momence';
import { defineStep, type Journey } from '../types';

// After someone starts with the intro offer, nudge them toward a credit pack
// and then a membership. Exits the moment live Momence data shows they bought
// anything beyond the intro — no purchase mirroring, just a fresh look at
// their active packs before every send.

export const postIntroOffer: Journey = {
  id: 'post-intro-offer',
  kind: 'marketing',
  enroll: {
    source: 'event',
    events: ['purchase', 'session-booked'],
    async when(event) {
      if (event.type === 'purchase') {
        const introIds = getIntroOfferMembershipIds();
        return (
          (event.itemType === 'membership' || event.itemType === 'monthly-subscription') &&
          introIds.includes(event.saleItemId)
        );
      }
      if (event.type === 'session-booked') {
        // Fallback trigger while the experimental /host/sales endpoint is
        // unavailable: a member's first-ever booking is (almost always) the
        // intro offer. Fails safe — null/false means no enrollment.
        const first = await isMemberFirstBooking(String(event.memberId), event.sessionBookingId);
        return first === true;
      }
      return false;
    },
  },
  async exitWhen(ctx) {
    const introIds = getIntroOfferMembershipIds();
    const packs = await ctx.activePacks();
    // Any active pack or subscription that isn't the intro itself means the
    // pitch already landed (null-origin packs count — they own something).
    const bought = packs.find((p) => !p.membership || !introIds.includes(p.membership.id));
    return bought ? `already-purchased:${bought.membership?.name ?? 'imported-pack'}` : null;
  },
  steps: [
    defineStep({
      id: 'how-was-it',
      delayHours: 72, // ~3 days after the intro booking/purchase
      template: 'intro-follow-up',
      props: async (ctx) => ({ firstName: ctx.firstName }),
    }),
    defineStep({
      id: 'credit-pack',
      delayHours: 168, // day ~10
      template: 'credit-pack-pitch',
      props: async (ctx) => ({ firstName: ctx.firstName }),
    }),
    defineStep({
      id: 'membership',
      delayHours: 264, // day ~21
      template: 'membership-pitch',
      // Skip the membership pitch for someone who has never come back since
      // the intro — the winback problem is different from the upsell problem.
      skipIf: async (ctx) => (await ctx.member()).visits.totalVisits < 2,
      props: async (ctx) => ({ firstName: ctx.firstName }),
    }),
  ],
};
