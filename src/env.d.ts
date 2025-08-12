/// <reference path="../.astro/types.d.ts" />

// Fallback module declaration for .astro files to satisfy TypeScript in editors/lints
declare module '*.astro' {
  const Component: any;
  export default Component;
}

// Minimal env typing to satisfy lints without pulling in full Astro types
interface ImportMetaEnv {
  readonly BASE_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}