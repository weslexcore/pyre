import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import {
  loadPostConfig,
  type PostConfig,
  resolvePageDuration,
  resolveTransitionForPair,
} from './lib/config.ts';
import { joinedOutputPath, outputPath, renderEntry } from './lib/render-post.ts';
import { type RenderProgressEvent, concatMp4Pages } from './lib/render-video.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMP_DIR = resolve(PROJECT_ROOT, '.playwright-temp');

interface RenderArgs {
  post?: string;
  all?: boolean;
  size?: string;
}

async function listPosts(): Promise<string[]> {
  const entries = await readdir(resolve(PROJECT_ROOT, 'posts'), { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * In-place TTY status line that lets callers display "recording 2.3s/5.0s",
 * "transcoding 67%", etc. while a long ffmpeg/Playwright phase runs without
 * filling the scrollback. Becomes a no-op when stdout isn't a TTY (e.g. piped
 * to a file or run from CI), so log files stay clean.
 */
function makeProgressLine(stream: NodeJS.WriteStream = process.stdout): {
  update: (text: string) => void;
  clear: () => void;
} {
  const isTTY = !!stream.isTTY;
  let active = false;
  let lastText = '';
  return {
    update(text: string) {
      if (!isTTY || text === lastText) return;
      stream.write(`\r    ${text}\x1b[K`);
      lastText = text;
      active = true;
    },
    clear() {
      if (!isTTY || !active) return;
      stream.write('\r\x1b[K');
      active = false;
      lastText = '';
    },
  };
}

function formatProgressEvent(e: RenderProgressEvent): string {
  const pct = (n: number) => `${Math.round(n)}%`;
  switch (e.phase) {
    case 'navigate':
      return 'loading page';
    case 'settle':
      return 'settling';
    case 'record':
      return e.detail ? `recording ${e.detail}` : 'recording';
    case 'finalize':
      return 'finalizing recording';
    case 'transcode':
      return typeof e.percent === 'number' ? `transcoding ${pct(e.percent)}` : 'transcoding';
    case 'probe':
      return e.detail ? `probing ${e.detail}` : 'probing durations';
    case 'encode': {
      const head = typeof e.percent === 'number' ? `encoding ${pct(e.percent)}` : 'encoding';
      return e.detail ? `${head} (${e.detail})` : head;
    }
    default:
      return e.phase;
  }
}

async function renderPost(vite: ViteDevServer, postName: string, filter?: string): Promise<void> {
  const config = await loadPostConfig(postName, PROJECT_ROOT);
  const baseUrl = `http://localhost:${vite.config.server.port}`;
  const totalPages = pagesFor(config);

  const exports = filter ? config.exports.filter((e) => e.size === filter) : config.exports;
  if (exports.length === 0) {
    console.warn(`No exports matched filter "${filter}" for post "${postName}"`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const progress = makeProgressLine();
  try {
    for (const entry of exports) {
      const pagePaths: string[] = [];
      const pageDurationsMs: number[] = [];
      for (let page = 1; page <= totalPages; page++) {
        const out = outputPath(postName, entry, page, PROJECT_ROOT);
        const durationMs =
          entry.format === 'mp4' ? resolvePageDuration(config, entry, page - 1) : undefined;
        const durLabel = durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : '';
        console.log(
          `  → ${entry.size} (${entry.format}) page ${page}/${totalPages}${durLabel}  ${out.replace(PROJECT_ROOT, '.')}`
        );
        await renderEntry({
          browser,
          postName,
          entry,
          page,
          baseUrl,
          projectRoot: PROJECT_ROOT,
          tempDir: TEMP_DIR,
          settleMs: config.settleMs,
          durationMs,
          onProgress: (e) => progress.update(formatProgressEvent(e)),
        });
        progress.clear();
        pagePaths.push(out);
        if (durationMs !== undefined) pageDurationsMs.push(durationMs);
      }
      if (entry.format === 'mp4' && totalPages > 1) {
        const joined = joinedOutputPath(postName, entry, PROJECT_ROOT);
        const transitions = Array.from({ length: totalPages - 1 }, (_, i) =>
          resolveTransitionForPair(config, i)
        );
        const tag = transitions
          .map((t) =>
            t.type === 'none' || t.durationMs <= 0 ? 'cut' : `${t.type}/${t.durationMs}ms`
          )
          .join(', ');
        console.log(
          `  → ${entry.size} (mp4) joined ${totalPages} pages [${tag}]  ${joined.replace(PROJECT_ROOT, '.')}`
        );
        await concatMp4Pages(pagePaths, joined, TEMP_DIR, {
          transitions,
          pageDurationsMs,
          onProgress: (e) => progress.update(formatProgressEvent(e)),
        });
        progress.clear();
      }
    }
  } finally {
    progress.clear();
    await browser.close();
  }
}

function pagesFor(config: PostConfig): number {
  return config.pages ?? 1;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('render')
    .description('Render Instagram posts from HTML/CSS to PNG/MP4')
    .argument('[post]', 'Post name (folder under posts/)')
    .option('--all', 'Render every post in posts/')
    .option(
      '--size <key>',
      'Render only this size (square, portrait, landscape, reel, story, small-menu, postcard-4x6)'
    )
    .parse(process.argv);

  const args = program.opts<RenderArgs>();
  const postArg = program.args[0];

  if (!postArg && !args.all) {
    program.help();
  }

  await mkdir(TEMP_DIR, { recursive: true });
  const vite = await createServer({
    root: PROJECT_ROOT,
    server: { port: 5174, strictPort: true },
    appType: 'mpa',
    logLevel: 'warn',
  });
  await vite.listen();

  try {
    const posts = args.all ? await listPosts() : [postArg!];
    for (const post of posts) {
      console.log(`Rendering ${post}`);
      await renderPost(vite, post, args.size);
    }
  } finally {
    await vite.close();
    await rm(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
