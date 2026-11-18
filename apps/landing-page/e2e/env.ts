// Ports and the environment the app runs with under test. Shared by
// playwright.config.ts (which starts the servers) and the specs (which talk to
// the mock server's control API).

export const APP_PORT = 4329;
export const MOCK_PORT = 4330;
export const MOCK_URL = `http://localhost:${MOCK_PORT}`;

/** Shared secret the app sends to the mock integrations service. */
export const E2E_SECRET = 'e2e-secret';

/**
 * Passed to `astro dev`. Variables already in the process environment take
 * priority over .env / .env.local, so this both points the upstreams at the
 * mock server and blanks every credential that would otherwise reach a real
 * service from a developer's machine. Empty means "not configured" everywhere
 * the app reads these.
 */
export const APP_ENV: Record<string, string> = {
  // Turns off the Astro dev toolbar (astro.config.mjs).
  E2E: '1',
  // Momence v1 (events, teachers, products) -> mock server
  MOMENCE_HOST_ID: 'e2e',
  MOMENCE_API_TOKEN: 'e2e',
  MOMENCE_API_BASE: `${MOCK_URL}/momence`,
  // Integrations service (referral lookup / redemption, partner verification)
  INTEGRATIONS_API_URL: `${MOCK_URL}/integrations`,
  REFERRAL_API_SECRET: E2E_SECRET,
  PARTNER_API_SECRET: E2E_SECRET,
  // Not configured: Redis, Google Places, PostHog, Momence OAuth, Mailchimp,
  // Turnstile, admin list, webhooks.
  KV_REST_API_URL: '',
  KV_REST_API_TOKEN: '',
  GOOGLE_PLACES_API_KEY: '',
  GOOGLE_PLACE_ID: '',
  POSTHOG_API_KEY: '',
  POSTHOG_PERSONAL_API_KEY: '',
  POSTHOG_PROJECT_ID: '',
  POSTHOG_HOST: '',
  MOMENCE_OAUTH_CLIENT_ID: '',
  MOMENCE_OAUTH_CLIENT_SECRET: '',
  MOMENCE_WEBHOOK_SECRET: '',
  MOMENCE_WEBHOOK_SIGNING_SECRET: '',
  MOMENCE_HOST_EMAIL: '',
  MOMENCE_HOST_PASSWORD: '',
  MOMENCE_BACKFILL_SECRET: '',
  MAILCHIMP_API_KEY: '',
  MAILCHIMP_AUDIENCE_ID: '',
  CLOUDFLARE_TURNSTILE_SECRET_KEY: '',
  PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: '',
  ADMIN_EMAILS: '',
  // Root base path and a localhost site URL, whatever .env says.
  PUBLIC_ASTRO_BASE: '/',
  VERCEL_PROJECT_PRODUCTION_URL: `localhost:${APP_PORT}`,
  VERCEL_URL: '',
  ASTRO_TELEMETRY_DISABLED: '1',
};
