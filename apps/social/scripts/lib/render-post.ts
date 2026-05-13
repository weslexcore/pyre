import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import type { ExportEntry } from './config.ts';
import { renderImage } from './render-image.ts';
import { renderVideo } from './render-video.ts';

export function pageUrl(baseUrl: string, postName: string, page: number): string {
  return `${baseUrl}/posts/${postName}/index.html#page=${page}`;
}

export function outputPath(
  postName: string,
  entry: ExportEntry,
  page: number,
  projectRoot: string
): string {
  const ext = entry.format === 'jpg' ? 'jpg' : entry.format;
  const base = entry.filename ?? entry.size;
  return resolve(projectRoot, 'exports', postName, `${base}-${page}.${ext}`);
}

export interface RenderEntryOptions {
  browser: Browser;
  postName: string;
  entry: ExportEntry;
  page: number;
  baseUrl: string;
  projectRoot: string;
  tempDir: string;
  settleMs?: number;
}

/** Render a single (size, format, page) tuple. Returns the absolute output path. */
export async function renderEntry(opts: RenderEntryOptions): Promise<string> {
  const out = outputPath(opts.postName, opts.entry, opts.page, opts.projectRoot);
  const postUrl = pageUrl(opts.baseUrl, opts.postName, opts.page);
  if (opts.entry.format === 'mp4') {
    await renderVideo({
      browser: opts.browser,
      postUrl,
      entry: opts.entry,
      outPath: out,
      tempDir: opts.tempDir,
      settleMs: opts.settleMs,
    });
  } else {
    await renderImage({
      browser: opts.browser,
      postUrl,
      entry: opts.entry,
      outPath: out,
      settleMs: opts.settleMs,
    });
  }
  return out;
}
