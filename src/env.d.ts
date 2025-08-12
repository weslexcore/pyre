/// <reference path="../.astro/types.d.ts" />

// Minimal env typing to satisfy lints without pulling in full Astro types
interface ImportMetaEnv {
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}