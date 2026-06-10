// Dev-mode email gate. When EMAIL_DEV_MODE=true, emails are only delivered to
// addresses on EMAIL_DEV_WHITELIST; everything else is suppressed. Enforced at
// the single sendTemplate() choke point so ALL emails (confirmations,
// first-timer, future cron/journeys) honor it automatically.

export function isDevMode(): boolean {
  return import.meta.env.EMAIL_DEV_MODE === 'true';
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
