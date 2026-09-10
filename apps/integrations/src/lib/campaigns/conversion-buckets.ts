// Which report column a conversion row lands in.
//
// The campaign-performance query returns one row per (campaign, bucket), where
// a bucket is an event name — or, for purchase_completed, the event name
// joined with its purchase_kind ('purchase:credit_pack') so packs and
// memberships can be told apart in one GROUP BY. This maps a bucket to the
// column the UI shows; anything unmapped (renewals, gift cards, unknown kinds)
// is captured in PostHog but not counted as a campaign conversion.

export const SIGNUP_INTRO = 'Intro Offer Signup';
export const SIGNUP_MAILING = 'Mailing List Signup';
export const BOOKING = 'booking_completed';
export const PURCHASE = 'purchase_completed';
/** Companion events from the one-off attribution backfill (see
 * scripts/backfill-booking-attribution.mts); counted as bookings. */
export const BOOKING_BACKFILL = 'booking_attribution_backfill';

export const PURCHASE_BUCKET_PREFIX = 'purchase:';

export type ConversionColumn =
  | 'introOfferSignups'
  | 'mailingListSignups'
  | 'bookings'
  | 'introPurchases'
  | 'creditPacks'
  | 'memberships';

export type ConversionCounts = Record<ConversionColumn, number>;

export const EMPTY_CONVERSIONS: Readonly<ConversionCounts> = Object.freeze({
  introOfferSignups: 0,
  mailingListSignups: 0,
  bookings: 0,
  introPurchases: 0,
  creditPacks: 0,
  memberships: 0,
});

const BUCKET_COLUMNS: Record<string, ConversionColumn> = {
  [SIGNUP_INTRO]: 'introOfferSignups',
  [SIGNUP_MAILING]: 'mailingListSignups',
  [BOOKING]: 'bookings',
  [BOOKING_BACKFILL]: 'bookings',
  [`${PURCHASE_BUCKET_PREFIX}intro_offer`]: 'introPurchases',
  [`${PURCHASE_BUCKET_PREFIX}credit_pack`]: 'creditPacks',
  [`${PURCHASE_BUCKET_PREFIX}membership`]: 'memberships',
};

export function bucketColumn(bucket: string): ConversionColumn | null {
  return BUCKET_COLUMNS[bucket] ?? null;
}

/** Fill every column from a partial tally so rows never carry undefined. */
export function conversionCounts(
  counts: ReadonlyMap<ConversionColumn, number> | undefined
): ConversionCounts {
  const out: ConversionCounts = { ...EMPTY_CONVERSIONS };
  if (!counts) return out;
  for (const [column, n] of counts) out[column] = n;
  return out;
}
