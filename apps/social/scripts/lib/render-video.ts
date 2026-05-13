import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import type { Browser } from 'playwright';
import type { ExportEntry } from './config.ts';
import { SIZES } from './sizes.ts';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export async function renderVideo(opts: {
  browser: Browser;
  postUrl: string;
  entry: ExportEntry;
  outPath: string;
  tempDir: string;
  settleMs?: number;
}): Promise<void> {
  const size = SIZES[opts.entry.size];
  const duration = opts.entry.duration ?? 5000;
  const sessionTempDir = join(opts.tempDir, `${opts.entry.size}-${Date.now()}`);
  await mkdir(sessionTempDir, { recursive: true });

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
    await page.goto(opts.postUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (opts.settleMs) {
      await page.waitForTimeout(opts.settleMs);
    }
    await page.waitForTimeout(duration);
    webmPath = await page.video()?.path();
  } finally {
    await context.close();
  }

  if (!webmPath) {
    throw new Error('Playwright did not produce a video file');
  }

  await mkdir(dirname(opts.outPath), { recursive: true });
  await transcodeToMp4(webmPath, opts.outPath);
  await rm(sessionTempDir, { recursive: true, force: true });
}

function transcodeToMp4(input: string, output: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    ffmpeg(input)
      .videoCodec('libx264')
      .outputOptions([
        '-preset slow',
        '-crf 18',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-r 30',
      ])
      .on('end', () => resolveP())
      .on('error', (err) => rejectP(err))
      .save(output);
  });
}
