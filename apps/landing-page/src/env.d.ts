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
  export const getImage: any;
}

// Minimal declarations for static asset imports used by astro:assets pipeline
declare module '*.png' {
  const metadata: any;
  export default metadata;
}
