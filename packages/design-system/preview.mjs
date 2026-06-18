// Local preview server for @pyre/design-system.
// Bundles preview/main.tsx (React included) and serves the package root so
// styles.css and fonts/ resolve. Run: `yarn dev` (or `npm run dev`).
import { context } from "esbuild";

const ctx = await context({
  entryPoints: ["preview/main.tsx"],
  outfile: "preview/app.js",
  bundle: true,
  format: "esm",
  jsx: "automatic",
  sourcemap: true,
  // React is bundled in for the preview (not external) so it runs standalone.
  loader: { ".woff2": "file" },
});

await ctx.watch();
const { port } = await ctx.serve({ servedir: ".", host: "127.0.0.1" });
console.log(`\n  Pyre Design System preview → http://127.0.0.1:${port}/preview/\n`);
