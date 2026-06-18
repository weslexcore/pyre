import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import type { ExportEntry } from './config.ts';
import { renderImage } from './render-image.ts';
import { type OnRenderProgress, renderVideo } from './render-video.ts';

export function pageUrl(baseUrl: string, postName: string, page: number): string {
  return `${baseUrl}/posts/${postName}/index.html#page=${page}`;
}

/** Export file base name: post title + size (e.g. "menu-drinks-sheet-letter"),
 *  or the entry's explicit filename override when provided. */
function baseName(postName: string, entry: ExportEntry): string {
  return entry.filename ?? `${postName}-${entry.size}`;
}

export function outputPath(
  postName: string,
  entry: ExportEntry,
  page: number,
  projectRoot: string
): string {
  const ext = entry.format === 'jpg' ? 'jpg' : entry.format;
  // Single-page posts get a clean name; page 2+ are suffixed to avoid collisions.
  const suffix = page > 1 ? `-${page}` : '';
  return resolve(projectRoot, 'exports', postName, `${baseName(postName, entry)}${suffix}.${ext}`);
}

/** Path for the joined-across-pages mp4 of a single export entry. */
export function joinedOutputPath(
  postName: string,
  entry: ExportEntry,
  projectRoot: string
): string {
  return resolve(projectRoot, 'exports', postName, `${baseName(postName, entry)}.mp4`);
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
  /** Overrides entry.duration for this page (mp4 only). */
  durationMs?: number;
  /** Forwarded to renderVideo for mp4 entries; ignored for png/jpg. */
  onProgress?: OnRenderProgress;
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
      durationMs: opts.durationMs,
      onProgress: opts.onProgress,
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
