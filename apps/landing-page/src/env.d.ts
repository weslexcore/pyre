/// <reference path="../.astro/types.d.ts" />

// Fallback module declaration for .astro files to satisfy TypeScript in editors/lints
declare module '*.astro' {
  const Component: any;
  export default Component;
}

// Minimal env typing to satisfy lints without pulling in full Astro types
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
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

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

// Minimal declaration to satisfy editor/linter for astro:assets Image component usage
declare module 'astro:assets' {
  export const Image: any;
  export const Picture: any;
  export const getImage: any;
}

// Minimal declarations for static asset imports used by astro:assets pipeline
declare module '*.png' {
  const metadata: any;
  export default metadata;
}
