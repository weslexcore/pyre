import steppingOut from '../assets/images/stepping_out.webp';
import type { PartnerImage } from './partner';

// Copy for /perks: perks Pyre members get at partner businesses, the reverse
// of the partner landing pages (/bft, /embody, /humble-haven), where partner
// members get a discount at Pyre.
//
// A member picks a partner and enters their booking email. We email them a
// confirm link; on click, integrations checks Momence for an active
// membership and emails the partner that it's valid
// (apps/integrations src/lib/partner/member-verification.ts).
//
// Each partner here must exist on /admin/partners (integrations) with the same
// `slug`, and have its "Perk for Pyre members" field filled in. Without that
// field the request is refused. Keep `perk` here in step with that field:
// this is what the page promises, that is what the partner's email says.

export interface MemberPerkPartner {
  /** Matches the partner's slug on /admin/partners. */
  slug: string;
  name: string;
  /** Neighbourhood or a few words on where they are. */
  where: string;
  /** What Pyre members get, e.g. "15% off class packs". */
  perk: string;
  description: string;
}

export interface MemberPerksContent {
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    image: PartnerImage;
  };
  partners: {
    title: string;
    subtitle: string;
    claimLabel: string;
    items: MemberPerkPartner[];
  };
  steps: {
    title: string;
    items: { title: string; description: string }[];
  };
  form: {
    title: string;
    subtitle: string;
    partnerLabel: string;
    partnerPlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    emailHelp: string;
    submitLabel: string;
    submittingLabel: string;
    successMessage: string;
    errorMessage: string;
  };
  notMember: {
    title: string;
    body: string;
    cta: { label: string; href: string; ariaLabel: string };
  };
  disclaimer: string;
}

const memberPerks: MemberPerksContent = {
  meta: {
    title: 'Member Perks | Pyre Sauna',
    description:
      'Pyre members get perks at our partner studios and gyms around Richmond. Verify your membership in two clicks and we let the partner know.',
  },
  hero: {
    eyebrow: 'For Pyre members',
    title: 'Your membership works\nbeyond our door.',
    subtitle:
      "Pyre members get perks at the studios and gyms we partner with around Richmond. Tell us where you're headed, and we'll vouch for you.",
    image: {
      src: steppingOut,
      alt: 'A guest stepping out through the sauna door',
      position: 'center 30%',
    },
  },
  partners: {
    title: 'Where your membership counts',
    subtitle: 'Pick a partner, verify once, and mention Pyre when you book with them.',
    claimLabel: 'Claim this perk',
    // TODO(perks): confirm each perk with the partner before launch, and enter
    // the same wording in "Perk for Pyre members" on /admin/partners.
    items: [
      {
        slug: 'bft',
        name: 'BFT Carytown',
        where: 'Carytown',
        perk: '15% off class packs',
        description: 'Coached group strength and conditioning, just across the river.',
      },
      {
        slug: 'humble-haven',
        name: 'Humble Haven Yoga',
        where: 'Forest Ave',
        perk: '15% off class packs',
        description: 'Heated power vinyasa, plus unheated and adaptive classes.',
      },
      {
        slug: 'embody',
        name: 'Embody Pilates',
        where: 'Forest Hill',
        perk: '15% off class packs',
        description: 'Small-group reformer Pilates, a short walk from Pyre.',
      },
    ],
  },
  steps: {
    title: 'How it works',
    items: [
      {
        title: 'Pick a partner',
        description: 'Choose where you want your perk and enter the email you book Pyre with.',
      },
      {
        title: 'Confirm from your inbox',
        description: 'We email you a link. Nothing is shared with the partner until you click it.',
      },
      {
        title: 'We vouch for you',
        description:
          'We check your membership and email the partner that it is active. Mention Pyre when you book.',
      },
    ],
  },
  form: {
    title: 'Verify your membership',
    subtitle: 'Takes ten seconds. We only contact the partner after you confirm.',
    partnerLabel: 'Partner',
    partnerPlaceholder: 'Choose a partner',
    emailLabel: 'The email you book with at Pyre',
    emailPlaceholder: 'you@example.com',
    emailHelp: 'We look up your membership by this email and send the confirm link here.',
    submitLabel: 'Send my confirm link',
    submittingLabel: 'Sending…',
    successMessage:
      'Check your inbox. Click the link in our email and we will let the partner know, usually within a minute.',
    errorMessage: 'Something went wrong. Please try again.',
  },
  notMember: {
    title: 'Not a member yet?',
    body: 'Partner perks come with an active Pyre membership.',
    cta: {
      label: 'See memberships',
      href: '/unlimited?utm_source=perks&utm_medium=site&utm_campaign=member-perks',
      ariaLabel: 'See Pyre memberships',
    },
  },
  disclaimer:
    'Perks are offered by each partner and may change. Requires an active Pyre membership; intro offers and credit packs do not qualify. When you confirm, we share your name, email, and membership with the partner you chose, and nothing else.',
};

export default memberPerks;
