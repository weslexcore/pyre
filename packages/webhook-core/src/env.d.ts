// Minimal typing for the Vite/Astro `import.meta.env` this package reads.
// The consuming app supplies the real values at build time.
interface ImportMetaEnv {
  readonly KV_REST_API_URL?: string;
  readonly KV_REST_API_TOKEN?: string;
  readonly MAILCHIMP_API_KEY?: string;
  readonly MAILCHIMP_AUDIENCE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
