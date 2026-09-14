// Pure rules for standalone short links, shared by the form (live checks as
// you type) and the API (the same checks before anything is written). No I/O
// and no store import, so the island never pulls in the Redis client.

export const SHORT_LINK_LIMITS = {
  alias: 64,
  label: 120,
  url: 2048,
} as const;

// Mirrors @pyre/webhook-core's ALIAS_PATTERN exactly — the test asserts
// parity — so the form never accepts a name the store will refuse.
const ALIAS_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Whether `alias` is a name the short-link store accepts as a code. */
export function isValidAlias(alias: string): boolean {
  return ALIAS_PATTERN.test(alias);
}

/**
 * A custom name as it will be stored: trimmed, lowercased, spaces folded to
 * dashes. Lowercase because short links get read aloud and typed from print,
 * and "Summer-Sale" and "summer-sale" would otherwise be two different links.
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, SHORT_LINK_LIMITS.alias);
}

/** Why a (normalized) custom name is not usable, or null when it is. */
export function aliasError(alias: string): string | null {
  if (!alias) return null;
  if (!isValidAlias(alias)) {
    return 'Use only letters, numbers, dashes, and underscores.';
  }
  return null;
}

/**
 * Two URLs that send people to the same place share a key: same host (www or
 * not, any case), same path (trailing slash or not), same query minus the
 * utm_* tags a campaign link adds, and no fragment. This is what "a short
 * link already exists for this destination" means. Returns null when the
 * input is not an http(s) URL.
 */
export function destinationKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length
    ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : '';
  return `${host}${path}${query}`;
}
