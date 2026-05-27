import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

export interface TransitionConfig {
  /** ffmpeg xfade name ('fade', 'dissolve', 'slideleft', 'slideup', 'wipeleft', 'wipeup', 'circleopen'…) or 'none' for a hard cut. */
  type?: string;
  /** Crossfade length in ms. */
  durationMs?: number;
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
  /** Per-page recording durations in ms, indexed 0..pages-1. Falls back to entry.duration then 5000. */
  pageDurations?: number[];
  /**
   * Per-pair transitions when joining mp4 exports. Slot i is the transition between page i+1 and page i+2,
   * so length should be pages-1. Missing or null slots fall back to {@link transition} and then to
   * {@link DEFAULT_TRANSITION}.
   */
  transitions?: (TransitionConfig | null)[];
  /** Single-transition fallback for any unset slot in {@link transitions}. */
  transition?: TransitionConfig;
}

export function defineConfig(config: PostConfig): PostConfig {
  return config;
}

export const DEFAULT_TRANSITION: Required<TransitionConfig> = {
  type: 'fade',
  durationMs: 500,
};

/** Path to the per-post JSON sidecar that the preview UI writes when the user tweaks durations/transitions. */
export function localOverridesPath(postName: string, projectRoot: string): string {
  return resolve(projectRoot, 'posts', postName, 'post.local.json');
}

interface LocalOverrides {
  pageDurations?: number[];
  transition?: TransitionConfig;
  transitions?: (TransitionConfig | null)[];
}

async function readLocalOverrides(postName: string, projectRoot: string): Promise<LocalOverrides> {
  const path = localOverridesPath(postName, projectRoot);
  if (!existsSync(path)) return {};
  try {
    const raw = await readFile(path, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as LocalOverrides;
    return {
      pageDurations: Array.isArray(parsed.pageDurations) ? parsed.pageDurations : undefined,
      transition: parsed.transition && typeof parsed.transition === 'object' ? parsed.transition : undefined,
      transitions: Array.isArray(parsed.transitions) ? parsed.transitions : undefined,
    };
  } catch {
    return {};
  }
}

/** Load and validate posts/<postName>/post.config.ts, merging optional post.local.json overrides. */
export async function loadPostConfig(postName: string, projectRoot: string): Promise<PostConfig> {
  const configPath = resolve(projectRoot, 'posts', postName, 'post.config.ts');
  if (!existsSync(configPath)) {
    throw new Error(`No post.config.ts found at ${configPath}`);
  }
  // Cache-bust so the manifest reflects fresh edits during dev.
  const mod = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
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

  const overrides = await readLocalOverrides(postName, projectRoot);
  return {
    ...config,
    pageDurations: overrides.pageDurations ?? config.pageDurations,
    transition: overrides.transition ?? config.transition,
    transitions: overrides.transitions ?? config.transitions,
  };
}

/** Resolve the effective duration (ms) for a single page of a single mp4 export entry. */
export function resolvePageDuration(
  config: PostConfig,
  entry: ExportEntry,
  pageIndex: number
): number {
  const fromArray = config.pageDurations?.[pageIndex];
  if (typeof fromArray === 'number' && fromArray > 0) return fromArray;
  if (typeof entry.duration === 'number' && entry.duration > 0) return entry.duration;
  return 5000;
}

/** Resolve the effective post-wide fallback transition. Used when {@link resolveTransitionForPair} has no per-pair value. */
export function resolveTransition(config: PostConfig): Required<TransitionConfig> {
  const t = config.transition;
  return {
    type: t?.type ?? DEFAULT_TRANSITION.type,
    durationMs:
      typeof t?.durationMs === 'number' && t.durationMs >= 0
        ? t.durationMs
        : DEFAULT_TRANSITION.durationMs,
  };
}

/**
 * Resolve the transition between page (pairIndex+1) and page (pairIndex+2).
 * Looks up config.transitions[pairIndex] first, then config.transition, then {@link DEFAULT_TRANSITION}.
 */
export function resolveTransitionForPair(
  config: PostConfig,
  pairIndex: number
): Required<TransitionConfig> {
  const slot = config.transitions?.[pairIndex];
  const fallback = resolveTransition(config);
  if (!slot) return fallback;
  return {
    type: typeof slot.type === 'string' ? slot.type : fallback.type,
    durationMs:
      typeof slot.durationMs === 'number' && slot.durationMs >= 0 ? slot.durationMs : fallback.durationMs,
  };
}
