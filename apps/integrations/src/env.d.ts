/// <reference types="astro/client" />

interface ImportMetaEnv {
  // Momence webhook verification
  readonly MOMENCE_WEBHOOK_SECRET?: string;
  readonly MOMENCE_WEBHOOK_SIGNING_SECRET?: string;
  readonly MOMENCE_BACKFILL_SECRET?: string;
  // Momence host API auth (password / refresh grant)
  readonly MOMENCE_HOST_EMAIL?: string;
  readonly MOMENCE_HOST_PASSWORD?: string;
  readonly MOMENCE_OAUTH_CLIENT_ID?: string;
  readonly MOMENCE_OAUTH_CLIENT_SECRET?: string;
  // Momence v1 Events API (session-type resolution)
  readonly MOMENCE_HOST_ID?: string;
  readonly MOMENCE_API_TOKEN?: string;
  // Mailchimp
  readonly MAILCHIMP_API_KEY?: string;
  readonly MAILCHIMP_AUDIENCE_ID?: string;
  // Upstash Redis (shared with landing-page admin dashboard)
  readonly KV_REST_API_URL?: string;
  readonly KV_REST_API_TOKEN?: string;
  // PostHog server-side event capture
  readonly POSTHOG_API_KEY?: string;
  readonly POSTHOG_HOST?: string;
  // Resend transactional email
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM?: string;
  // Dev-mode email whitelist gate
  readonly EMAIL_DEV_MODE?: string;
  readonly EMAIL_DEV_WHITELIST?: string;
  // Public base URL for links in emails (e.g. https://pyresauna.com)
  readonly PUBLIC_SITE_URL?: string;
  // Base URL for hosted email images (defaults to this app's production deployment)
  readonly PUBLIC_EMAIL_ASSET_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
