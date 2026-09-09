// The placement catalog: every place a campaign gets promoted, with its
// utm_source / utm_medium / utm_content locked in code. Staff pick a tile;
// the server builds the link. Nobody types a source or medium for a standard
// placement, which is what keeps PostHog and the performance report on one
// vocabulary.
//
// Mediums line up with the conventions already in use elsewhere: lifecycle
// emails send utm_medium=email (src/emails/components/utm.ts), partner
// discount links send utm_medium=partner, referrals utm_medium=referral.
//
// Adding a placement is a code change on purpose. Change the key of an
// existing one and every link generated under the old key reads as "Custom"
// on the detail page — the stored utm values are unaffected.

export type PlacementGroup = 'social' | 'paid' | 'email' | 'sms' | 'print' | 'partner' | 'other';

export interface Placement {
  key: string;
  label: string;
  group: PlacementGroup;
  source: string;
  medium: string;
  content: string;
  /** What to paste where. Shown on the generated row. */
  hint: string;
  /** The short link is the one to paste (bios, texts, print). */
  preferShort: boolean;
  /** Label for a required source input — the partner's name becomes utm_source. */
  askSource?: string;
  /** Opens the free-text utm fields instead of using the locked values. */
  custom?: true;
}

export const PLACEMENT_GROUPS: ReadonlyArray<{ key: PlacementGroup; label: string }> = [
  { key: 'social', label: 'Social' },
  { key: 'paid', label: 'Paid' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'Text' },
  { key: 'print', label: 'Print' },
  { key: 'partner', label: 'Partners' },
  { key: 'other', label: 'Other' },
];

export const CUSTOM_PLACEMENT_KEY = 'custom';

export const PLACEMENTS: readonly Placement[] = [
  {
    key: 'instagram-bio',
    label: 'Instagram bio',
    group: 'social',
    source: 'instagram',
    medium: 'social',
    content: 'bio-link',
    preferShort: true,
    hint: 'Paste the short link into the bio URL field.',
  },
  {
    key: 'instagram-story',
    label: 'Instagram story',
    group: 'social',
    source: 'instagram',
    medium: 'social',
    content: 'story',
    preferShort: true,
    hint: 'Use the short link as the link sticker URL.',
  },
  {
    key: 'instagram-post',
    label: 'Instagram post',
    group: 'social',
    source: 'instagram',
    medium: 'social',
    content: 'post',
    preferShort: true,
    hint: 'Captions are not clickable. Put the short link in the caption and point people to the bio.',
  },
  {
    key: 'facebook-post',
    label: 'Facebook post',
    group: 'social',
    source: 'facebook',
    medium: 'social',
    content: 'post',
    preferShort: false,
    hint: 'Paste the full link so Facebook renders the preview card.',
  },
  {
    key: 'linkedin-post',
    label: 'LinkedIn post',
    group: 'social',
    source: 'linkedin',
    medium: 'social',
    content: 'post',
    preferShort: false,
    hint: 'Paste the full link into the post.',
  },
  {
    key: 'meta-ad',
    label: 'Instagram or Facebook ad',
    group: 'paid',
    source: 'meta',
    medium: 'paid_social',
    content: 'ad',
    preferShort: false,
    hint: 'Use the full link as the ad destination URL.',
  },
  {
    key: 'google-ads',
    label: 'Google Ads',
    group: 'paid',
    source: 'google',
    medium: 'cpc',
    content: 'ad',
    preferShort: false,
    hint: 'Use the full link as the final URL. Leave auto-tagging on as well.',
  },
  {
    key: 'email-newsletter',
    label: 'Email newsletter',
    group: 'email',
    source: 'newsletter',
    medium: 'email',
    content: 'cta',
    preferShort: false,
    hint: 'Full link on the main button. Add a variant (footer, image) for a second link in the same email.',
  },
  {
    key: 'sms-blast',
    label: 'Text message',
    group: 'sms',
    source: 'sms',
    medium: 'sms',
    content: 'link',
    preferShort: true,
    hint: 'Short link only. It keeps the text to one segment.',
  },
  {
    key: 'qr-print',
    label: 'QR code',
    group: 'print',
    source: 'qr',
    medium: 'print',
    content: 'qr',
    preferShort: true,
    hint: 'Download the PNG. The code encodes the short link.',
  },
  {
    key: 'poster-url',
    label: 'Poster or flyer URL',
    group: 'print',
    source: 'print',
    medium: 'print',
    content: 'flyer',
    preferShort: true,
    hint: 'Print the short link. People will type it.',
  },
  {
    key: 'partner-share',
    label: 'Partner share',
    group: 'partner',
    source: 'partner',
    medium: 'partner',
    content: 'share',
    preferShort: true,
    askSource: 'Partner name',
    hint: 'The partner name becomes utm_source, matching the partner discount links.',
  },
  {
    key: CUSTOM_PLACEMENT_KEY,
    label: 'Other',
    group: 'other',
    source: '',
    medium: '',
    content: '',
    preferShort: false,
    custom: true,
    hint: 'Only when nothing above fits. Values are slugified.',
  },
];

export function placementByKey(key: string): Placement | undefined {
  return PLACEMENTS.find((p) => p.key === key);
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Mediums and sources already in the catalog, offered as suggestions on the
 * custom form so a one-off still lands on a known value where possible. */
export const PLACEMENT_MEDIUMS = distinct([
  ...PLACEMENTS.map((p) => p.medium),
  'referral',
  'partner',
]);
export const PLACEMENT_SOURCES = distinct(PLACEMENTS.map((p) => p.source));
