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
  // PostHog HogQL querying for the campaign-performance admin tool (personal
  // API key with Query Read scope + numeric project id — the phc_ capture
  // token cannot run queries)
  readonly POSTHOG_PERSONAL_API_KEY?: string;
  readonly POSTHOG_PROJECT_ID?: string;
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
  // Mailchimp webhook signing secret (X-Mailchimp-Signature HMAC verification)
  readonly MAILCHIMP_WEBHOOK_SIGNING_SECRET?: string;
  // Supabase durable engine state (journeys, send log, suppressions) — service-role, server-only
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  // Admin dashboard allowlist (comma-separated emails, same contract as landing-page)
  readonly ADMIN_EMAILS?: string;
  // Cron auth (QStash schedule forwards "Authorization: Bearer ${CRON_SECRET}")
  readonly CRON_SECRET?: string;
  // HMAC secret for signed unsubscribe links (defaults to CRON_SECRET if unset)
  readonly UNSUBSCRIBE_SECRET?: string;
  // Partner verification: shared secret the landing page sends on /api/partner/request
  readonly PARTNER_API_SECRET?: string;
  // HMAC secret for signed confirm/deny links (defaults to CRON_SECRET if unset)
  readonly PARTNER_LINK_SECRET?: string;
  // Per-partner contact addresses for confirm/deny + quarterly reconciliation
  readonly PARTNER_BFT_CONTACT_EMAIL?: string;
  // Pyre staff address CC'd on all partner-facing verification email
  readonly PARTNER_CC_EMAIL?: string;
  // Momence membership ids that count as the intro offer (comma-separated)
  readonly MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS?: string;
  // Google review deep link used by the review-request journey
  readonly GOOGLE_REVIEW_URL?: string;
  // Speed up journey delays for whitelist testing (hours -> minutes)
  readonly JOURNEY_FAST_MODE?: string;
  // Dev-mode email whitelist gate
  readonly EMAIL_DEV_MODE?: string;
  readonly EMAIL_DEV_WHITELIST?: string;
  // Template keys / prefix globs (e.g. "partner-*") that send for real even in dev mode
  readonly EMAIL_LIVE_TEMPLATES?: string;
  // Public base URL of the landing site (e.g. https://pyresauna.com). Used for
  // links in emails, and by the admin tools for short-link origins, event
  // links, and the blog-posts/events feeds.
  readonly PUBLIC_SITE_URL?: string;
  // Base URL for hosted email images (defaults to this app's production deployment)
  readonly PUBLIC_EMAIL_ASSET_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    // Set by src/middleware.ts for /admin/* pages: the authenticated Momence
    // user (not yet allowlist-checked — AdminLayout enforces isAdminEmail).
    adminUser?: import('./lib/auth/types').MomenceUserProfile;
  }
}
