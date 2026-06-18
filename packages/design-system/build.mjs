// Builds the importable ESM bundle for @pyre/design-system.
// JS via esbuild (react/react-dom kept external); types via tsc (see package build script).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  jsx: "automatic",
  platform: "browser",
  target: "es2020",
  external: ["react", "react-dom", "react/jsx-runtime"],
  loader: { ".css": "empty" },
});

console.log("built dist/index.js");
