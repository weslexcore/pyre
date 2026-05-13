import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import type { Plugin } from 'vite';
import { type ExportEntry, loadPostConfig } from './config.ts';
import { renderEntry } from './render-post.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const TEMP_DIR = resolve(PROJECT_ROOT, '.playwright-temp');

interface RenderRequest {
  post?: string;
  size?: string;
  format?: string;
  page?: number;
  filename?: string;
}

/**
 * Registers POST /__render on the dev server so the preview UI can trigger
 * the same Playwright + ffmpeg pipeline as `yarn render`. A single Chromium
 * instance is launched lazily and reused; requests are serialized so
 * concurrent button clicks don't race fonts or the video recorder.
 */
export function renderPlugin(): Plugin {
  let browser: Browser | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function getBrowser(): Promise<Browser> {
    if (!browser) {
      browser = await chromium.launch({ headless: true });
    }
    return browser;
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  }

  return {
    name: 'pyre-social-render',
    configureServer(server) {
      server.middlewares.use('/__render', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method Not Allowed');
          return;
        }

        try {
          const body = await readJson(req);
          const { post, size, format, page, filename } = body;
          if (!post || !size || !format || !page) {
            return sendJson(res, 400, {
              ok: false,
              error: 'Missing required fields: post, size, format, page',
            });
          }

          const config = await loadPostConfig(post, PROJECT_ROOT);
          const entry = findEntry(config.exports, { size, format, filename });
          if (!entry) {
            return sendJson(res, 404, {
              ok: false,
              error: `No export entry matches size=${size} format=${format}${filename ? ` filename=${filename}` : ''} in posts/${post}/post.config.ts`,
            });
          }

          const totalPages = config.pages ?? 1;
          if (page < 1 || page > totalPages) {
            return sendJson(res, 400, {
              ok: false,
              error: `page ${page} out of range (1..${totalPages})`,
            });
          }

          const port = server.config.server.port ?? 5173;
          const baseUrl = `http://localhost:${port}`;

          await mkdir(TEMP_DIR, { recursive: true });
          const out = await enqueue(async () => {
            const b = await getBrowser();
            return renderEntry({
              browser: b,
              postName: post,
              entry,
              page,
              baseUrl,
              projectRoot: PROJECT_ROOT,
              tempDir: TEMP_DIR,
              settleMs: config.settleMs,
            });
          });

          const fileUrl = toUrl(out);
          sendJson(res, 200, { ok: true, file: fileUrl, name: fileUrl.split('/').pop() });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[/__render] failed:', err);
          sendJson(res, 500, { ok: false, error: message });
        }
      });

      server.httpServer?.on('close', async () => {
        try {
          await browser?.close();
          await rm(TEMP_DIR, { recursive: true, force: true });
        } catch {}
        browser = null;
      });
    },
  };
}

function findEntry(
  exports: ExportEntry[],
  match: { size: string; format: string; filename?: string }
): ExportEntry | undefined {
  return exports.find(
    (e) =>
      e.size === match.size &&
      e.format === match.format &&
      (match.filename ? e.filename === match.filename : true)
  );
}

function readJson(req: IncomingMessage): Promise<RenderRequest> {
  return new Promise((resolveP, rejectP) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolveP(raw ? JSON.parse(raw) : {});
      } catch (e) {
        rejectP(e);
      }
    });
    req.on('error', rejectP);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function toUrl(absPath: string): string {
  const rel = absPath.startsWith(PROJECT_ROOT) ? absPath.slice(PROJECT_ROOT.length) : absPath;
  return rel.replaceAll('\\', '/').replace(/^\/+/, '/');
}
