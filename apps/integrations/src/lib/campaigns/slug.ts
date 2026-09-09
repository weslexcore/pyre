// Slug helpers shared by the form preview (client) and the validators
// (server). slugifyCampaign mirrors @pyre/webhook-core's exactly — the test
// asserts parity — so the preview under the name field shows the value the
// store will file the campaign under.

/** Slugify a display name into a stable utm_campaign value. */
export function slugifyCampaign(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slugify a variant suffix or a custom utm value. Underscores survive
 * (utm_medium=paid_social is the GA4 convention) — everything else that is
 * not a letter or digit collapses to a dash.
 */
export function slugifyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
