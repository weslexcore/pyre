import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium } from 'playwright';
import type { Plugin } from 'vite';
import {
  type ExportEntry,
  type TransitionConfig,
  loadPostConfig,
  localOverridesPath,
  resolvePageDuration,
  resolveTransitionForPair,
} from './config.ts';
import { joinedOutputPath, renderEntry } from './render-post.ts';
import { type RenderProgressEvent, concatMp4Pages } from './render-video.ts';

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

interface JoinRequest {
  post?: string;
  size?: string;
  format?: string;
  filename?: string;
  /** Per-pair overrides. Slot i is the transition between page i+1 and page i+2 (length = pages-1). */
  transitions?: (TransitionConfig | null)[];
  /** Legacy single-transition fallback applied to every pair when transitions[] is absent. */
  transition?: TransitionConfig;
}

interface ConfigRequest {
  post?: string;
  pageDurations?: number[];
  transition?: TransitionConfig;
  transitions?: (TransitionConfig | null)[];
}

/**
 * Registers POST /__render, /__join, /__config on the dev server so the preview UI
 * can trigger the same Playwright + ffmpeg pipeline as `yarn render`. A single
 * Chromium instance is launched lazily and reused; requests are serialized so
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

        const stream = startNdjsonStream(res);
        try {
          const body = (await readJson(req)) as RenderRequest;
          const { post, size, format, page, filename } = body;
          if (!post || !size || !format || !page) {
            stream.send({
              type: 'done',
              ok: false,
              error: 'Missing required fields: post, size, format, page',
            });
            return;
          }

          const config = await loadPostConfig(post, PROJECT_ROOT);
          const entry = findEntry(config.exports, { size, format, filename });
          if (!entry) {
            stream.send({
              type: 'done',
              ok: false,
              error: `No export entry matches size=${size} format=${format}${filename ? ` filename=${filename}` : ''} in posts/${post}/post.config.ts`,
            });
            return;
          }

          const totalPages = config.pages ?? 1;
          if (page < 1 || page > totalPages) {
            stream.send({
              type: 'done',
              ok: false,
              error: `page ${page} out of range (1..${totalPages})`,
            });
            return;
          }

          const port = server.config.server.port ?? 5173;
          const baseUrl = `http://localhost:${port}`;
          const durationMs =
            entry.format === 'mp4' ? resolvePageDuration(config, entry, page - 1) : undefined;

          await mkdir(TEMP_DIR, { recursive: true });
          stream.send({
            type: 'phase',
            phase: 'page-render',
            pageIndex: page,
            totalPages,
            size: entry.size,
            format: entry.format,
            durationMs,
          });
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
              durationMs,
              onProgress:
                entry.format === 'mp4'
                  ? (e: RenderProgressEvent) =>
                      stream.send({ type: 'progress', pageIndex: page, totalPages, ...e })
                  : undefined,
            });
          });

          const fileUrl = toUrl(out);
          stream.send({ type: 'done', ok: true, file: fileUrl, name: fileUrl.split('/').pop() });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[/__render] failed:', err);
          stream.send({ type: 'done', ok: false, error: message });
        } finally {
          stream.end();
        }
      });

      server.middlewares.use('/__join', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method Not Allowed');
          return;
        }

        const stream = startNdjsonStream(res);
        try {
          const body = (await readJson(req)) as JoinRequest;
          const {
            post,
            size,
            format,
            filename,
            transition: bodyTransition,
            transitions: bodyTransitions,
          } = body;
          if (!post || !size || !format) {
            stream.send({
              type: 'done',
              ok: false,
              error: 'Missing required fields: post, size, format',
            });
            return;
          }
          if (format !== 'mp4') {
            stream.send({
              type: 'done',
              ok: false,
              error: `Join only applies to mp4 exports (got format=${format})`,
            });
            return;
          }

          const config = await loadPostConfig(post, PROJECT_ROOT);
          const entry = findEntry(config.exports, { size, format, filename });
          if (!entry) {
            stream.send({
              type: 'done',
              ok: false,
              error: `No export entry matches size=${size} format=${format}${filename ? ` filename=${filename}` : ''} in posts/${post}/post.config.ts`,
            });
            return;
          }

          const totalPages = config.pages ?? 1;
          if (totalPages < 2) {
            stream.send({
              type: 'done',
              ok: false,
              error: `Nothing to join: post has pages=${totalPages}`,
            });
            return;
          }

          // Body wins over saved config so the user can preview transitions without persisting.
          const effectiveConfig = {
            ...config,
            transition: bodyTransition ?? config.transition,
            transitions: bodyTransitions ?? config.transitions,
          };
          const transitions = Array.from({ length: totalPages - 1 }, (_, i) =>
            resolveTransitionForPair(effectiveConfig, i)
          );

          const port = server.config.server.port ?? 5173;
          const baseUrl = `http://localhost:${port}`;

          await mkdir(TEMP_DIR, { recursive: true });
          const out = await enqueue(async () => {
            const b = await getBrowser();
            // Re-render every per-page mp4 so the join always reflects current pageDurations.
            // concatMp4Pages probes actual file lengths, so stale files would otherwise win.
            const pagePaths: string[] = [];
            const pageDurationsMs: number[] = [];
            for (let page = 1; page <= totalPages; page++) {
              const durationMs = resolvePageDuration(config, entry, page - 1);
              pageDurationsMs.push(durationMs);
              stream.send({
                type: 'phase',
                phase: 'page-render',
                pageIndex: page,
                totalPages,
                size: entry.size,
                format: entry.format,
                durationMs,
              });
              const rendered = await renderEntry({
                browser: b,
                postName: post,
                entry,
                page,
                baseUrl,
                projectRoot: PROJECT_ROOT,
                tempDir: TEMP_DIR,
                settleMs: config.settleMs,
                durationMs,
                onProgress: (e: RenderProgressEvent) =>
                  stream.send({ type: 'progress', pageIndex: page, totalPages, ...e }),
              });
              pagePaths.push(rendered);
            }
            const joined = joinedOutputPath(post, entry, PROJECT_ROOT);
            stream.send({
              type: 'phase',
              phase: 'concat',
              totalPages,
              size: entry.size,
              transitions: transitions.map((t) => ({ type: t.type, durationMs: t.durationMs })),
            });
            await concatMp4Pages(pagePaths, joined, TEMP_DIR, {
              transitions,
              pageDurationsMs,
              onProgress: (e: RenderProgressEvent) => stream.send({ type: 'progress', ...e }),
            });
            return joined;
          });

          const fileUrl = toUrl(out);
          stream.send({ type: 'done', ok: true, file: fileUrl, name: fileUrl.split('/').pop() });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[/__join] failed:', err);
          stream.send({ type: 'done', ok: false, error: message });
        } finally {
          stream.end();
        }
      });

      server.middlewares.use('/__config', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST');
          res.end('Method Not Allowed');
          return;
        }

        try {
          const body = (await readJson(req)) as ConfigRequest;
          const { post } = body;
          if (!post) {
            return sendJson(res, 400, { ok: false, error: 'Missing required field: post' });
          }
          // Validate post exists (loadPostConfig throws otherwise).
          await loadPostConfig(post, PROJECT_ROOT);

          const path = localOverridesPath(post, PROJECT_ROOT);
          const existing = await readSidecar(path);
          const next: {
            pageDurations?: number[];
            transition?: TransitionConfig;
            transitions?: (TransitionConfig | null)[];
          } = { ...existing };

          if (body.pageDurations !== undefined) {
            if (
              !Array.isArray(body.pageDurations) ||
              body.pageDurations.some((d) => typeof d !== 'number' || !(d > 0))
            ) {
              return sendJson(res, 400, {
                ok: false,
                error: 'pageDurations must be an array of positive numbers (ms).',
              });
            }
            next.pageDurations = body.pageDurations;
          }
          if (body.transition !== undefined) {
            if (body.transition === null || typeof body.transition !== 'object') {
              return sendJson(res, 400, { ok: false, error: 'transition must be an object.' });
            }
            next.transition = sanitizeTransition(body.transition);
          }
          if (body.transitions !== undefined) {
            if (!Array.isArray(body.transitions)) {
              return sendJson(res, 400, { ok: false, error: 'transitions must be an array.' });
            }
            next.transitions = body.transitions.map((t) =>
              t && typeof t === 'object' ? sanitizeTransition(t) : null
            );
          }

          await writeSidecarAtomic(path, next);
          sendJson(res, 200, { ok: true, sidecar: next });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[/__config] failed:', err);
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

interface SidecarShape {
  pageDurations?: number[];
  transition?: TransitionConfig;
  transitions?: (TransitionConfig | null)[];
}

async function readSidecar(path: string): Promise<SidecarShape> {
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSidecarAtomic(path: string, body: SidecarShape): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function sanitizeTransition(t: TransitionConfig): TransitionConfig {
  return {
    type: typeof t.type === 'string' ? t.type : undefined,
    durationMs:
      typeof t.durationMs === 'number' && t.durationMs >= 0 ? t.durationMs : undefined,
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

function readJson(req: IncomingMessage): Promise<unknown> {
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

/**
 * Streaming response for the render/join endpoints. The browser parses newline-delimited
 * JSON to surface per-phase progress (page render, ffmpeg transcode/encode percent)
 * instead of staring at a frozen status while a multi-minute job runs.
 */
function startNdjsonStream(res: ServerResponse): {
  send: (msg: unknown) => void;
  end: () => void;
} {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-store');
  // Tell intermediaries (and Vite's dev proxy) not to buffer chunks — we depend on flushes
  // landing in the browser as they're written.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  return {
    send(msg) {
      if (closed) return;
      try {
        res.write(`${JSON.stringify(msg)}\n`);
      } catch {
        closed = true;
      }
    },
    end() {
      if (closed) return;
      closed = true;
      try {
        res.end();
      } catch {}
    },
  };
}

function toUrl(absPath: string): string {
  const rel = absPath.startsWith(PROJECT_ROOT) ? absPath.slice(PROJECT_ROOT.length) : absPath;
  return rel.replaceAll('\\', '/').replace(/^\/+/, '/');
}
