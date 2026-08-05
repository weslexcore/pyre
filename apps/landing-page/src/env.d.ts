/// <reference path="../.astro/types.d.ts" />

// Fallback module declaration for .astro files to satisfy TypeScript in editors/lints
declare module '*.astro' {
  const Component: any;
  export default Component;
}

// Project-specific env typing; BASE_URL/PROD and other built-ins come from
// Astro's own types (astro/client, referenced via .astro/types.d.ts)
interface ImportMetaEnv {
  readonly PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: string;
  readonly CLOUDFLARE_TURNSTILE_SECRET_KEY: string;
  readonly MOMENCE_HOST_ID: string;
  readonly MOMENCE_API_TOKEN: string;
  // Momence OAuth V2
  readonly MOMENCE_OAUTH_CLIENT_ID: string;
  readonly MOMENCE_OAUTH_CLIENT_SECRET: string;
  // Upstash Redis (via Vercel KV integration)
  readonly KV_REST_API_URL: string;
  readonly KV_REST_API_TOKEN: string;
  // Admin
  readonly ADMIN_EMAILS: string;
  // Partner verification hand-off to the integrations service
  readonly INTEGRATIONS_API_URL: string;
  readonly PARTNER_API_SECRET: string;
  // PostHog project token (client snippet + shared with integrations service)
  readonly POSTHOG_API_KEY: string;
  // PostHog query API (admin campaign performance)
  readonly POSTHOG_PERSONAL_API_KEY: string;
  readonly POSTHOG_PROJECT_ID: string;
  readonly POSTHOG_HOST: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Cloudflare Turnstile type declarations
interface TurnstileRenderOptions {
  sitekey: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact';
  callback?: (token: string) => void;
  'error-callback'?: () => void;
  'expired-callback'?: () => void;
}

interface Turnstile {
  render(container: string | HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

interface Window {
  turnstile?: Turnstile;
}
