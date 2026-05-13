import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin } from 'vite';
import { renderPlugin } from './lib/render-plugin.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

interface PostManifestEntry {
  name: string;
  pages: number;
  exports: { size: string; format: string; duration?: number }[];
}

/**
 * Vite plugin that exposes /__posts.json — the dev shell uses it to enumerate
 * posts and build the multi-viewport preview iframes for the selected post.
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
            const configPath = resolve(dir, entry.name, 'post.config.ts');
            try {
              const src = await readFile(configPath, 'utf8');
              const { exports, pages } = parseConfigSource(src);
              posts.push({ name: entry.name, pages, exports });
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

/**
 * Cheap regex scan of post.config.ts so we don't need to evaluate TS at request time.
 * Returns the minimal info the preview shell needs to lay out iframes.
 */
function parseConfigSource(src: string): {
  exports: { size: string; format: string; duration?: number }[];
  pages: number;
} {
  const exports: { size: string; format: string; duration?: number }[] = [];
  const block = src.match(/exports\s*:\s*\[([\s\S]*?)\]/);
  if (block) {
    const entryRe = /\{([^}]+)\}/g;
    for (;;) {
      const m = entryRe.exec(block[1]);
      if (!m) break;
      const body = m[1];
      const size = body.match(/size\s*:\s*['"]([^'"]+)['"]/)?.[1];
      const format = body.match(/format\s*:\s*['"]([^'"]+)['"]/)?.[1];
      const duration = body.match(/duration\s*:\s*(\d+)/)?.[1];
      if (size && format) {
        exports.push({ size, format, duration: duration ? Number(duration) : undefined });
      }
    }
  }
  const pagesMatch = src.match(/^\s*pages\s*:\s*(\d+)/m);
  const pages = pagesMatch ? Number(pagesMatch[1]) : 1;
  return { exports, pages };
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
