// Email images live in this app's public/ dir and are served by its Vercel
// deployment (email clients can't load local assets). PUBLIC_EMAIL_ASSET_BASE
// overrides the default, e.g. to point at a custom domain or a preview
// deployment. import.meta.env is undefined in the react-email preview server,
// hence the optional chaining.
export const ASSET_BASE =
  import.meta.env?.PUBLIC_EMAIL_ASSET_BASE ?? 'https://pyre-integrations.vercel.app/email';

// Origin that serves the image proxy (src/pages/api/img). Derived from the same
// env the static assets use so preview/staging deployments proxy through
// themselves; defaults to this app's production deployment.
const PROXY_ORIGIN = import.meta.env?.PUBLIC_EMAIL_ASSET_BASE
  ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
  : 'https://pyre-integrations.vercel.app';

/**
 * Rewrite a Momence image URL to our on-domain proxy so the asset appears to
 * come from us in email HTML. Non-Momence URLs (already on our domain, or an
 * unknown host) and falsy values pass through unchanged.
 */
export function proxyImageUrl(url?: string): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.momence.com') return url;
    return `${PROXY_ORIGIN}/api/img${u.pathname}`;
  } catch {
    return url;
  }
}
