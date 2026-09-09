// Canonical URL shape for a single event page.
//
// Event links get texted and pasted, so the path carries a readable slug on top
// of the Momence session id: /events/142154582-full-moon-sauna. Only the leading
// digits are load-bearing — the slug is decoration that keeps the link legible,
// and a stale slug (renamed session) still resolves and redirects to the current
// one.

const MAX_SLUG_LENGTH = 60;

/** URL-safe slug for an event title, e.g. "Full Moon Sauna + DJ" -> "full-moon-sauna-dj". */
export function eventSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  // Trim on a word boundary so the slug never ends mid-word.
  return slug.slice(0, MAX_SLUG_LENGTH).replace(/-[^-]*$/, '');
}

/** The canonical path for an event, e.g. "/events/142154582-full-moon-sauna". */
export function eventPath(event: { id: string; title: string }): string {
  const slug = eventSlug(event.title);
  return slug ? `/events/${event.id}-${slug}` : `/events/${event.id}`;
}

/**
 * The Momence session id from a route param. Accepts both the bare id and the
 * slugged form; returns null when the param doesn't start with digits.
 */
export function parseEventId(param: string | undefined): string | null {
  if (!param) return null;
  const match = /^(\d+)(?:-|$)/.exec(param);
  return match ? match[1] : null;
}
