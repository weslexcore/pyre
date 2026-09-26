// The two origins links get built against. Server-only.
//
// appOrigin: this app's own deployment — where signed links (unsubscribe,
// claim, calendar, partner decision, sub claim) and QStash worker URLs point.
// PUBLIC_EMAIL_ASSET_BASE may carry a /email path; only its origin counts
// (same convention as emails/components/assets.ts).
//
// siteOrigin: the public marketing site (landing-page), where booking,
// referral and short links resolve. process.env fallback: vars added after
// the cached build only exist at runtime.

export function appOrigin(): string {
  return import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
}

export function siteOrigin(): string {
  return import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
}
