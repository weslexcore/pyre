// UTM tagging for links inside journey/marketing emails.
//
// Conventions (aligned with the landing-page UTM Assist builder and the
// PostHog campaign-performance attribution on $initial_utm_*):
//   utm_source   = lifecycle   (automated journey email; broadcasts will use
//                               a different source, e.g. "newsletter")
//   utm_medium   = email
//   utm_campaign = the journey/campaign id used everywhere else
//                  (post-intro-offer, review-request, credit-expiry,
//                  unused-credit) so web-side attribution joins cleanly with
//                  the journey_* and email_* events
//   utm_content  = which link/CTA inside the email
//
// Do NOT apply to third-party deep links we don't control (the Google review
// URL) — extra params can break them, and click attribution for those comes
// from Resend's click webhook instead.

export function emailLink(url: string, campaign: string, content?: string): string {
  const u = new URL(url);
  u.searchParams.set('utm_source', 'lifecycle');
  u.searchParams.set('utm_medium', 'email');
  u.searchParams.set('utm_campaign', campaign);
  if (content) u.searchParams.set('utm_content', content);
  return u.toString();
}
