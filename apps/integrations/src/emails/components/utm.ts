// UTM tagging for links inside journey/marketing emails.
//
// Conventions (aligned with the landing-page UTM Assist builder and the
// PostHog campaign-performance attribution on $initial_utm_*):
//   utm_source   = lifecycle   (automated journey email; broadcasts will use
//                               a different source, e.g. "newsletter")
//   utm_medium   = email
//   utm_campaign = the campaign the email belongs to (for journeys, the
//                  journey's linked campaign, else its id) so web-side
//                  attribution joins cleanly with the journey_* and email_*
//                  events
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

// --- Dashboard-built journey emails ---
//
// Every link an admin writes into a journey email is tagged at render time, so
// nobody has to build tracked links by hand:
//   utm_source=lifecycle, utm_medium=email, utm_campaign=<journey id>,
//   utm_content=<step key>-<link label>
// Only our own site and Momence checkout links are tagged (third-party deep
// links can break with extra params). Tags already on a link win — a link
// copied from the Campaigns tool keeps the campaign it was built for.

export const JOURNEY_TAGGED_HOSTS = ['pyresauna.com', 'momence.com'] as const;

export function linkSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .replace(/-$/, '') || 'link'
  );
}

/**
 * utm_content for a link: which step it sits in, then which link. A bare URL
 * (its text is the address itself) is named by its page path instead.
 */
export function journeyLinkContent(
  stepKey: string | undefined,
  label: string,
  href?: string
): string {
  let name = label;
  if (href && label.trim() === href.trim()) {
    try {
      const url = new URL(href);
      name =
        url.pathname.replace(/\/+$/, '').split('/').pop() || url.hostname.replace(/^www\./, '');
    } catch {
      name = 'link';
    }
  }
  return stepKey ? `${stepKey}-${linkSlug(name)}` : linkSlug(name);
}

export function isTaggedHost(href: string): boolean {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    return JOURNEY_TAGGED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** The link as it will be sent: tagged when it points at our site or Momence. */
export function journeyLink(href: string, campaign: string, content: string): string {
  if (!isTaggedHost(href)) return href;
  const url = new URL(href);
  const tags: [string, string][] = [
    ['utm_source', 'lifecycle'],
    ['utm_medium', 'email'],
    ['utm_campaign', campaign],
    ['utm_content', content],
  ];
  for (const [key, value] of tags) {
    if (!url.searchParams.get(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}
