import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SizeKey } from './sizes.ts';

export type ExportFormat = 'png' | 'jpg' | 'mp4';

export interface ExportEntry {
  size: SizeKey;
  format: ExportFormat;
  /** For mp4 only: total recording duration in ms. Default 5000. */
  duration?: number;
  /** Optional override of the output filename (without extension). */
  filename?: string;
}

export interface PostConfig {
  name: string;
  exports: ExportEntry[];
  /**
   * Number of stacked .page sections in index.html. Default 1. Must be a positive integer.
   * Each page is rendered to its own output file at every configured size/format.
   */
  pages?: number;
  /**
   * Optional: how long (ms) to wait after navigation before screenshot/recording starts.
   * Useful when the post has an entrance animation you want to skip past for a still.
   */
  settleMs?: number;
}

export function defineConfig(config: PostConfig): PostConfig {
  return config;
}

/** Load and validate posts/<postName>/post.config.ts. */
export async function loadPostConfig(postName: string, projectRoot: string): Promise<PostConfig> {
  const configPath = resolve(projectRoot, 'posts', postName, 'post.config.ts');
  if (!existsSync(configPath)) {
    throw new Error(`No post.config.ts found at ${configPath}`);
  }
  const mod = await import(pathToFileURL(configPath).href);
  const config = (mod.default ?? mod.config) as PostConfig | undefined;
  if (!config) {
    throw new Error(`post.config.ts at ${configPath} must default-export a config object`);
  }
  if (!Array.isArray(config.exports) || config.exports.length === 0) {
    throw new Error(`post.config.ts at ${configPath} must declare at least one export entry`);
  }
  if (config.pages !== undefined && (!Number.isInteger(config.pages) || config.pages < 1)) {
    throw new Error(
      `post.config.ts at ${configPath}: pages must be a positive integer (got ${String(config.pages)})`
    );
  }
  return config;
}
