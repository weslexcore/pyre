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
  // Resend transactional + marketing email
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM?: string;
  // Optional Resend segment new contacts are attached to (broadcast target).
  // Contacts themselves are account-global since Resend's segments migration.
  readonly RESEND_SEGMENT_ID?: string;
  // Resend webhook (svix) signing secret
  readonly RESEND_WEBHOOK_SECRET?: string;
  // Mailchimp audience webhook shared secret (query param)
  readonly MAILCHIMP_WEBHOOK_SECRET?: string;
  // Supabase durable engine state (journeys, send log, suppressions) — service-role, server-only
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  // Vercel cron auth (Vercel sends "Authorization: Bearer ${CRON_SECRET}")
  readonly CRON_SECRET?: string;
  // HMAC secret for signed unsubscribe links (defaults to CRON_SECRET if unset)
  readonly UNSUBSCRIBE_SECRET?: string;
  // Momence membership ids that count as the intro offer (comma-separated)
  readonly MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS?: string;
  // Google review deep link used by the review-request journey
  readonly GOOGLE_REVIEW_URL?: string;
  // Speed up journey delays for whitelist testing (hours -> minutes)
  readonly JOURNEY_FAST_MODE?: string;
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
