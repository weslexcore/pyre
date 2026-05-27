import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import type { Browser } from 'playwright';
import type { ExportEntry } from './config.ts';
import { SIZES } from './sizes.ts';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export type RenderProgressPhase =
  | 'navigate'
  | 'settle'
  | 'record'
  | 'finalize'
  | 'transcode'
  | 'probe'
  | 'encode';

export interface RenderProgressEvent {
  phase: RenderProgressPhase;
  /** 0..100 when known. */
  percent?: number;
  /** Free-form human-readable detail (e.g. "1.2s/5.0s", "page 2/5"). */
  detail?: string;
}

export type OnRenderProgress = (event: RenderProgressEvent) => void;

function clampPercent(p: unknown): number | undefined {
  if (typeof p !== 'number' || !Number.isFinite(p)) return undefined;
  return Math.min(100, Math.max(0, p));
}

/**
 * @ffmpeg-installer doesn't ship ffprobe, so we parse the `Duration:` line from `ffmpeg -i`
 * stderr instead of pulling in another dependency. ffmpeg exits with code 1 on `-i` without an
 * output, which is expected — the metadata is already on stderr by then.
 */
async function probeDurationSec(file: string): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn(ffmpegInstaller.path, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    proc.on('error', rejectP);
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) {
        return rejectP(new Error(`Could not parse duration from ffmpeg output for ${file}`));
      }
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return rejectP(new Error(`Parsed non-positive duration for ${file}`));
      }
      resolveP(seconds);
    });
  });
}

export async function renderVideo(opts: {
  browser: Browser;
  postUrl: string;
  entry: ExportEntry;
  outPath: string;
  tempDir: string;
  settleMs?: number;
  /** Overrides entry.duration when provided (used for per-page durations). */
  durationMs?: number;
  /** Receives phase events plus periodic record/transcode progress (percent + detail). */
  onProgress?: OnRenderProgress;
}): Promise<void> {
  const size = SIZES[opts.entry.size];
  const duration = opts.durationMs ?? opts.entry.duration ?? 5000;
  const sessionTempDir = join(opts.tempDir, `${opts.entry.size}-${Date.now()}`);
  await mkdir(sessionTempDir, { recursive: true });

  const onProgress = opts.onProgress;
  const context = await opts.browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: sessionTempDir,
      size: { width: size.w, height: size.h },
    },
  });
  const page = await context.newPage();
  let webmPath: string | undefined;
  try {
    onProgress?.({ phase: 'navigate' });
    await page.goto(opts.postUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (opts.settleMs) {
      onProgress?.({ phase: 'settle' });
      await page.waitForTimeout(opts.settleMs);
    }
    const totalSec = (duration / 1000).toFixed(1);
    // page.waitForTimeout blocks the main task, so we tick on a side interval to surface
    // recording progress to callers (the dev UI's status bar, the CLI's TTY line).
    let ticker: ReturnType<typeof setInterval> | undefined;
    if (onProgress) {
      onProgress({ phase: 'record', percent: 0, detail: `0.0s/${totalSec}s` });
      const recordStart = Date.now();
      ticker = setInterval(() => {
        const elapsed = Math.min(duration, Date.now() - recordStart);
        onProgress({
          phase: 'record',
          percent: (elapsed / duration) * 100,
          detail: `${(elapsed / 1000).toFixed(1)}s/${totalSec}s`,
        });
      }, 250);
    }
    try {
      await page.waitForTimeout(duration);
    } finally {
      if (ticker) clearInterval(ticker);
    }
    onProgress?.({ phase: 'record', percent: 100, detail: `${totalSec}s/${totalSec}s` });
    onProgress?.({ phase: 'finalize' });
    webmPath = await page.video()?.path();
  } finally {
    await context.close();
  }

  if (!webmPath) {
    throw new Error('Playwright did not produce a video file');
  }

  await mkdir(dirname(opts.outPath), { recursive: true });
  await transcodeToMp4(webmPath, opts.outPath, onProgress);
  await rm(sessionTempDir, { recursive: true, force: true });
}

function transcodeToMp4(input: string, output: string, onProgress?: OnRenderProgress): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    onProgress?.({ phase: 'transcode', percent: 0 });
    ffmpeg(input)
      .videoCodec('libx264')
      .outputOptions([
        '-preset slow',
        '-crf 18',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-r 30',
      ])
      .on('progress', (p: { percent?: number; timemark?: string }) => {
        onProgress?.({ phase: 'transcode', percent: clampPercent(p.percent), detail: p.timemark });
      })
      .on('end', () => {
        onProgress?.({ phase: 'transcode', percent: 100 });
        resolveP();
      })
      .on('error', (err) => rejectP(err))
      .save(output);
  });
}

export interface PairTransition {
  type: string;
  durationMs: number;
}

export interface ConcatOptions {
  /**
   * Per-pair transitions. Slot i defines the transition between input i and input i+1, so the
   * array should have inputs.length - 1 entries. A slot with type==='none' or durationMs<=0 is
   * joined with a hard cut at that boundary.
   */
  transitions?: PairTransition[];
  /**
   * Optional informational durations (ms) — kept for caller ergonomics but ignored by the join
   * logic, which probes each mp4 to use real lengths (Playwright recordings overshoot the
   * configured target).
   */
  pageDurationsMs?: number[];
  /** Phase + percent events for the probe and encode stages. */
  onProgress?: OnRenderProgress;
}

export async function concatMp4Pages(
  inputs: string[],
  output: string,
  tempDir: string,
  opts: ConcatOptions = {}
): Promise<void> {
  if (inputs.length < 2) {
    throw new Error(`concatMp4Pages requires at least 2 inputs (got ${inputs.length})`);
  }
  await mkdir(tempDir, { recursive: true });
  await mkdir(dirname(output), { recursive: true });

  const pairCount = inputs.length - 1;
  const transitions = opts.transitions ?? [];
  const usesAnyFade = transitions
    .slice(0, pairCount)
    .some((t) => t && t.type !== 'none' && t.durationMs > 0);
  const onProgress = opts.onProgress;

  if (usesAnyFade) {
    // Probe real mp4 durations — Playwright recordings include navigation overhead, so the file
    // is typically longer than the configured page duration. xfade offsets must be relative to
    // each input's actual length, not the user's intent value.
    onProgress?.({ phase: 'probe', detail: `${inputs.length} pages` });
    const actualMs = await Promise.all(
      inputs.map(async (p) => Math.round((await probeDurationSec(p)) * 1000))
    );
    for (let i = 0; i < pairCount; i++) {
      const t = transitions[i];
      if (!t || t.type === 'none' || t.durationMs <= 0) continue;
      if (!(actualMs[i] > t.durationMs)) {
        throw new Error(
          `concatMp4Pages: page ${i + 1} actual length ${actualMs[i]}ms is not longer than the ` +
            `${t.durationMs}ms ${t.type} transition into page ${i + 2}.`
        );
      }
    }
    await runFfmpegMixedJoin(inputs, output, transitions, actualMs, onProgress);
    return;
  }

  // ffmpeg concat demuxer treats single quotes as the literal-path delimiter; escape any in paths.
  const manifestBody = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  const manifestPath = join(tempDir, `concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(manifestPath, `${manifestBody}\n`, 'utf8');
  try {
    await runFfmpegConcat(manifestPath, output, onProgress);
  } finally {
    await rm(manifestPath, { force: true });
  }
}

function runFfmpegConcat(
  manifestPath: string,
  output: string,
  onProgress?: OnRenderProgress
): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    onProgress?.({ phase: 'encode', percent: 0, detail: 'concat' });
    ffmpeg()
      .input(manifestPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy', '-movflags +faststart'])
      .on('progress', (p: { percent?: number; timemark?: string }) => {
        onProgress?.({ phase: 'encode', percent: clampPercent(p.percent), detail: p.timemark });
      })
      .on('end', () => {
        onProgress?.({ phase: 'encode', percent: 100 });
        resolveP();
      })
      .on('error', (err) => rejectP(err))
      .save(output);
  });
}

/** xfade has no zero-duration mode; one frame at 30fps is visually indistinguishable from a hard cut. */
const HARD_CUT_FALLBACK_MS = Math.round(1000 / 30);

function runFfmpegMixedJoin(
  inputs: string[],
  output: string,
  transitions: PairTransition[],
  pageDurationsMs: number[],
  onProgress?: OnRenderProgress
): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    // Normalize each input — without this, mismatched SAR/fps/timestamps cause xfade to bail with
    // "Failed to inject frame into filter network." setpts resets the per-input PTS to 0 so xfade
    // offsets are interpreted relative to the running output's true cumulative duration.
    const filters: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      filters.push(`[${i}:v]fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[s${i}]`);
    }

    let prevLabel = `s0`;
    let cumulativeMs = pageDurationsMs[0];
    for (let i = 0; i < transitions.length && i < inputs.length - 1; i++) {
      const rightLabel = `s${i + 1}`;
      const isLast = i === inputs.length - 2;
      const outLabel = isLast ? 'vout' : `v${i + 1}`;
      const t = transitions[i];
      const isCut = !t || t.type === 'none' || t.durationMs <= 0;
      const effType = isCut ? 'fade' : t.type;
      const effDurMs = isCut ? HARD_CUT_FALLBACK_MS : t.durationMs;
      const offsetSec = (cumulativeMs - effDurMs) / 1000;
      const durSec = effDurMs / 1000;
      filters.push(
        `[${prevLabel}][${rightLabel}]xfade=transition=${effType}:duration=${durSec.toFixed(6)}:offset=${offsetSec.toFixed(6)}[${outLabel}]`
      );
      cumulativeMs += pageDurationsMs[i + 1] - effDurMs;
      prevLabel = outLabel;
    }
    const filterComplex = filters.join(';');

    onProgress?.({ phase: 'encode', percent: 0, detail: `xfade ${inputs.length} pages` });
    const cmd = ffmpeg();
    for (const input of inputs) cmd.input(input);
    cmd
      .complexFilter(filterComplex, ['vout'])
      .outputOptions([
        '-c:v libx264',
        '-preset slow',
        '-crf 18',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-r 30',
        '-an',
      ])
      .on('progress', (p: { percent?: number; timemark?: string }) => {
        onProgress?.({ phase: 'encode', percent: clampPercent(p.percent), detail: p.timemark });
      })
      .on('end', () => {
        onProgress?.({ phase: 'encode', percent: 100 });
        resolveP();
      })
      .on('error', (err) => rejectP(err))
      .save(output);
  });
}
