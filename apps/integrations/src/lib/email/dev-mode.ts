// Template-level email gate. EMAIL_LIVE_TEMPLATES is the allowlist of what
// delivers for real: a comma-separated list of exact template keys and/or
// `prefix-*` globs (e.g. "partner-*"); `*` makes every template live. Templates
// NOT on the list only reach addresses on EMAIL_DEV_WHITELIST — so emails under
// development stay dark by default, and whitelisted testers still receive
// everything. Enforced at the single sendTemplate() choke point so ALL emails
// (confirmations, first-timer, cron/journeys) honor it automatically.

export function isLiveTemplate(template: string): boolean {
  // process.env fallback: vars added after the cached build only exist at runtime.
  const patterns = (import.meta.env.EMAIL_LIVE_TEMPLATES ?? process.env.EMAIL_LIVE_TEMPLATES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const key = template.toLowerCase();
  return patterns.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p));
}

export function getWhitelist(): string[] {
  // process.env fallback: vars added after the cached build only exist at runtime.
  return (import.meta.env.EMAIL_DEV_WHITELIST ?? process.env.EMAIL_DEV_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRecipient(to: string): boolean {
  return getWhitelist().includes(to.toLowerCase());
}
