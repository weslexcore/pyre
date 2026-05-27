import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin } from 'vite';
import { loadPostConfig, type PostConfig, type TransitionConfig } from './lib/config.ts';
import { renderPlugin } from './lib/render-plugin.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

interface PostManifestEntry {
  name: string;
  pages: number;
  exports: { size: string; format: string; duration?: number; filename?: string }[];
  pageDurations?: number[];
  transition?: TransitionConfig;
  transitions?: (TransitionConfig | null)[];
}

/**
 * Vite plugin that exposes /__posts.json — the dev shell uses it to enumerate
 * posts and build the multi-viewport preview iframes for the selected post.
 * Pulls the merged config (TS defaults + post.local.json sidecar) so the UI
 * sees current per-page durations and the configured transition.
 */
function postsManifestPlugin(): Plugin {
  return {
    name: 'pyre-social-posts-manifest',
    configureServer(server) {
      server.middlewares.use('/__posts.json', async (_req, res) => {
        try {
          const dir = resolve(PROJECT_ROOT, 'posts');
          const entries = await readdir(dir, { withFileTypes: true });
          const posts: PostManifestEntry[] = [];
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            try {
              const config = await loadPostConfig(entry.name, PROJECT_ROOT);
              posts.push(serializePost(config));
            } catch {
              posts.push({ name: entry.name, pages: 1, exports: [] });
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ posts }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

function serializePost(config: PostConfig): PostManifestEntry {
  return {
    name: config.name,
    pages: config.pages ?? 1,
    exports: config.exports.map((e) => ({
      size: e.size,
      format: e.format,
      duration: e.duration,
      filename: e.filename,
    })),
    pageDurations: config.pageDurations,
    transition: config.transition,
    transitions: config.transitions,
  };
}

async function main(): Promise<void> {
  const server = await createServer({
    root: PROJECT_ROOT,
    server: { port: 5173, strictPort: true, open: '/preview/' },
    appType: 'mpa',
    plugins: [postsManifestPlugin(), renderPlugin()],
  });
  await server.listen();
  server.printUrls();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
