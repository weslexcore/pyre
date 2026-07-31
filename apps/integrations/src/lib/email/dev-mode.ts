// Dev-mode email gate. When EMAIL_DEV_MODE=true, emails are only delivered to
// addresses on EMAIL_DEV_WHITELIST; everything else is suppressed. Enforced at
// the single sendTemplate() choke point so ALL emails (confirmations,
// first-timer, future cron/journeys) honor it automatically.
//
// EMAIL_LIVE_TEMPLATES carves template-level exceptions out of dev mode: a
// comma-separated list of exact template keys and/or `prefix-*` globs (e.g.
// "partner-*") that deliver for real even while everything else stays gated.
// Lets one feature go live without opening the floodgates.

export function isDevMode(): boolean {
  return import.meta.env.EMAIL_DEV_MODE === 'true';
}

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
  return (import.meta.env.EMAIL_DEV_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedRecipient(to: string): boolean {
  return getWhitelist().includes(to.toLowerCase());
}
