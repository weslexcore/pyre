// Email images live in this app's public/ dir and are served by its Vercel
// deployment (email clients can't load local assets). PUBLIC_EMAIL_ASSET_BASE
// overrides the default, e.g. to point at a custom domain or a preview
// deployment. import.meta.env is undefined in the react-email preview server,
// hence the optional chaining.
export const ASSET_BASE =
  import.meta.env?.PUBLIC_EMAIL_ASSET_BASE ?? 'https://pyre-integrations.vercel.app/email';
