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