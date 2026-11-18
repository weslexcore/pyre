// The environment the app runs with under test, and the secrets specs sign
// requests with. Shared by playwright.config.ts (which starts the servers)
// and the specs.
//
// With E2E=1 the app reads no .env file (astro.config.mjs points envDir at
// this directory, which has none), so it sees exactly APP_ENV plus the shell.
// Every variable the app reads is listed: blank means "not configured", which
// also stops a value in a developer's shell from reaching a real service.

import { APP_PORT, APP_URL, MOCK_URL } from './ports';
import { supabaseStack } from './supabase';

export { APP_PORT, APP_URL, MOCK_PORT, MOCK_URL } from './ports';

export const SUPABASE = supabaseStack();

/** Known values for the app's shared secrets, so specs can sign and authorize requests. */
export const SECRETS = {
  cron: 'e2e-cron-secret',
  unsubscribe: 'e2e-unsubscribe-secret',
  referral: 'e2e-referral-secret',
  partner: 'e2e-partner-secret',
  partnerLink: 'e2e-partner-link-secret',
  scheduleLink: 'e2e-schedule-link-secret',
  momenceWebhook: 'e2e-momence-webhook-secret',
  momenceSigning: 'e2e-momence-signing-secret',
  momenceBackfill: 'e2e-momence-backfill-secret',
  mailchimpWebhook: 'e2e-mailchimp-webhook-secret',
  mailchimpSigning: 'e2e-mailchimp-signing-secret',
  // Svix format: whsec_ + base64 of the signing key.
  resendWebhook: `whsec_${Buffer.from('e2e-resend-signing-key').toString('base64')}`,
} as const;

/** Every variable the app reads, blank unless set below. */
const BLANK = Object.fromEntries(
  [
    'MOMENCE_HOST_EMAIL',
    'MOMENCE_HOST_PASSWORD',
    'MOMENCE_OAUTH_CLIENT_ID',
    'MOMENCE_OAUTH_CLIENT_SECRET',
    'MOMENCE_HOST_ID',
    'MOMENCE_API_TOKEN',
    'MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS',
    'MAILCHIMP_API_KEY',
    'MAILCHIMP_AUDIENCE_ID',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'POSTHOG_API_KEY',
    'POSTHOG_HOST',
    'POSTHOG_PERSONAL_API_KEY',
    'POSTHOG_PROJECT_ID',
    'RESEND_API_KEY',
    'RESEND_FROM',
    'RESEND_SEGMENT_ID',
    'ADMIN_EMAILS',
    'STAFF_EMAILS',
    'QSTASH_TOKEN',
    'QSTASH_URL',
    'VERCEL_AUTOMATION_BYPASS_SECRET',
    'PARTNER_BFT_CONTACT_EMAIL',
    'PARTNER_CC_EMAIL',
    'JOURNEY_FAST_MODE',
    'EMAIL_DEV_WHITELIST',
    'EMAIL_LIVE_TEMPLATES',
    'AGENTS_BASE_URL',
    'AGENT_API_SECRET',
    'EVE_CHANNEL_SECRET',
    'AGENTS_PROTECTION_BYPASS',
    'SUGGESTIONS_AUTO',
    'AI_GATEWAY_API_KEY',
    'BOARD_INTAKE_SECRET',
    'QUICKBOOKS_CLIENT_ID',
    'QUICKBOOKS_CLIENT_SECRET',
    'QUICKBOOKS_REALM_ID',
    'QUICKBOOKS_REFRESH_TOKEN',
    'QUICKBOOKS_ENVIRONMENT',
    'REFERRAL_REWARD_TAG_NAME',
    'REFERRAL_EXPIRY_DAYS',
    'VERCEL',
    'VERCEL_URL',
    'VERCEL_ENV',
    'VERCEL_GIT_COMMIT_REF',
  ].map((name) => [name, ''])
);

/**
 * Passed to `astro dev`. Supabase is the e2e stack; Momence and Resend are the
 * mock server (e2e/mock-server); everything else is blank.
 */
export const APP_ENV: Record<string, string> = {
  ...BLANK,
  // Read by astro.config.mjs: no .env files, no dev toolbar.
  E2E: '1',
  ASTRO_TELEMETRY_DISABLED: '1',
  // The public landing site (booking, referral and short links, its events
  // and blog feeds) -> mock server.
  PUBLIC_SITE_URL: `${MOCK_URL}/site`,
  // Email images from this app's own public/email, not the production deployment.
  PUBLIC_EMAIL_ASSET_BASE: `${APP_URL}/email`,

  // Supabase: the e2e stack. The local stack wants the legacy JWT keys.
  SUPABASE_URL: SUPABASE.apiUrl,
  SUPABASE_SECRET_KEY: SUPABASE.serviceRoleKey,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE.serviceRoleKey,
  SUPABASE_PUBLISHABLE_KEY: SUPABASE.anonKey,
  SUPABASE_ANON_KEY: SUPABASE.anonKey,

  // Momence v1 and v2 -> mock server.
  MOMENCE_API_BASE: `${MOCK_URL}/momence/api/v1`,
  MOMENCE_API_V2_BASE: `${MOCK_URL}/momence/api/v2`,
  MOMENCE_HOST_ID: 'e2e',
  MOMENCE_API_TOKEN: 'e2e',
  MOMENCE_HOST_EMAIL: 'host@e2e.test',
  MOMENCE_HOST_PASSWORD: 'e2e',
  MOMENCE_OAUTH_CLIENT_ID: 'e2e',
  MOMENCE_OAUTH_CLIENT_SECRET: 'e2e',

  // Resend -> mock server (the SDK reads RESEND_BASE_URL), which records
  // every email so specs can check what was sent.
  RESEND_BASE_URL: `${MOCK_URL}/resend`,
  RESEND_API_KEY: 're_e2e',
  RESEND_FROM: 'Pyre E2E <e2e@pyresauna.com>',

  // Shared secrets.
  CRON_SECRET: SECRETS.cron,
  UNSUBSCRIBE_SECRET: SECRETS.unsubscribe,
  REFERRAL_API_SECRET: SECRETS.referral,
  PARTNER_API_SECRET: SECRETS.partner,
  PARTNER_LINK_SECRET: SECRETS.partnerLink,
  SCHEDULE_LINK_SECRET: SECRETS.scheduleLink,
  MOMENCE_WEBHOOK_SECRET: SECRETS.momenceWebhook,
  MOMENCE_WEBHOOK_SIGNING_SECRET: SECRETS.momenceSigning,
  MOMENCE_BACKFILL_SECRET: SECRETS.momenceBackfill,
  MAILCHIMP_WEBHOOK_SECRET: SECRETS.mailchimpWebhook,
  MAILCHIMP_WEBHOOK_SIGNING_SECRET: SECRETS.mailchimpSigning,
  RESEND_WEBHOOK_SECRET: SECRETS.resendWebhook,

  VERCEL_PROJECT_PRODUCTION_URL: `localhost:${APP_PORT}`,
};
