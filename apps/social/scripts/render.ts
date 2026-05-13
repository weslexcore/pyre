import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { loadPostConfig, type PostConfig } from './lib/config.ts';
import { outputPath, renderEntry } from './lib/render-post.ts';

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
  try {
    for (const entry of exports) {
      for (let page = 1; page <= totalPages; page++) {
        const out = outputPath(postName, entry, page, PROJECT_ROOT);
        console.log(
          `  → ${entry.size} (${entry.format}) page ${page}/${totalPages}  ${out.replace(PROJECT_ROOT, '.')}`
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
        });
      }
    }
  } finally {
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
    .option('--size <key>', 'Render only this size (square, portrait, landscape, reel, story)')
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
