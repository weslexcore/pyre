// @ts-nocheck
/*
  Background Video Optimization Pipeline
  - Scans public/videos for raw sources and emits optimized variants and a manifest.
  - Requires ffmpeg and ffprobe on PATH.
*/

import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';

const projectRoot = process.cwd();
const publicDir = path.join(projectRoot, 'public');
const videosDir = path.join(publicDir, 'videos');
const manifestPath = path.join(videosDir, 'videos.manifest.json');

const pipelineVersion = '1.0.0';

type VideoPoster = { url: string; width: number; height: number; type: string };
type VideoVariant = {
  format: 'mp4' | 'webm' | 'av1';
  codec: string;
  width: number;
  height: number;
  bitrateKbps?: number;
  url: string;
};
type VideoSourceEntry = {
  id: string;
  sourcePath: string;
  contentHash: string;
  width: number;
  height: number;
  durationSec: number;
  variants: VideoVariant[];
  poster?: VideoPoster;
  preview?: { url: string; durationSec: number };
};
type VideoManifest = {
  pipelineVersion: string;
  generatedAt: string;
  sources: VideoSourceEntry[];
};

const sourceExtensions = ['.mov', '.mp4', '.m4v', '.webm', '.mkv'];
const supportedFormats = ['mp4', 'webm'] as const;
const targetHeights = [1080, 720, 480];

function execFile(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

async function which(bin: string): Promise<boolean> {
  const { code } = await execFile(process.platform === 'win32' ? 'where' : 'which', [bin]);
  return code === 0;
}

async function ensurePrereqs(): Promise<boolean> {
  const strict = process.env.VIDEO_OPT_STRICT === '1';
  const hasFfmpeg = await which('ffmpeg');
  const hasFfprobe = await which('ffprobe');
  if (!hasFfmpeg || !hasFfprobe) {
    const message = 'Missing ffmpeg/ffprobe. Install ffmpeg to enable video optimization.';
    if (strict) {
      console.error(message);
      return false;
    } else {
      console.warn(message + ' Skipping optimization.');
      return false;
    }
  }
  return true;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(filePath);
    return JSON.parse(buf.toString()) as T;
  } catch {
    return null;
  }
}

async function safeMkdirp(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

async function listSourceFiles(): Promise<string[]> {
  const entries: string[] = [];
  async function walk(dir: string) {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        await walk(full);
      } else if (sourceExtensions.includes(path.extname(f.name).toLowerCase())) {
        const name = f.name;
        const isGeneratedVariant = /\.[a-f0-9]{16}\.\d{3,4}p\.(mp4|webm)$/i.test(name);
        const isPoster = /\.[a-f0-9]{16}\.poster\.(jpg|webp)$/i.test(name);
        const isManifest = name === 'videos.manifest.json';
        if (!isGeneratedVariant && !isPoster && !isManifest) {
          entries.push(full);
        }
      }
    }
  }
  await walk(videosDir);
  return entries;
}

function deriveId(filePath: string): string {
  const base = path.basename(filePath);
  const name = base.replace(/\.[^.]+$/, '');
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').toLowerCase();
}

function computeHash(buffer: Buffer, signature: string): string {
  const h = createHash('sha256');
  h.update(buffer);
  h.update(pipelineVersion);
  h.update(signature);
  return h.digest('hex').slice(0, 16);
}

async function ffprobeMeta(file: string): Promise<{ width: number; height: number; durationSec: number; fps: number }> {
  const { stdout, code, stderr } = await execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate', '-show_format', '-of', 'json', file]);
  if (code !== 0) throw new Error('ffprobe failed: ' + stderr);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const fmt = data.format ?? {};
  const [num, den] = String(stream.avg_frame_rate || '0/1').split('/').map((n: string) => Number(n));
  const fps = den ? num / den : 0;
  const durationSec = fmt.duration ? Number(fmt.duration) : 0;
  return { width: Number(stream.width ?? 0), height: Number(stream.height ?? 0), durationSec, fps };
}

async function encodeVariant(src: string, outFile: string, height: number, fps: number, format: 'mp4' | 'webm'): Promise<void> {
  const gop = Math.max(2, Math.round(2 * (fps || 30)));
  const args: string[] = ['-y', '-i', src, '-an'];
  if (format === 'mp4') {
    args.push(
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-crf', '22',
      '-g', String(gop),
      '-keyint_min', String(gop)
    );
  } else {
    args.push(
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', '33',
      '-row-mt', '1',
      '-pix_fmt', 'yuv420p',
      '-g', String(gop)
    );
  }
  args.push('-vf', `scale=-2:${height}`);
  args.push(outFile);
  const { code, stderr } = await execFile('ffmpeg', args);
  if (code !== 0) throw new Error('ffmpeg failed: ' + stderr);
}

async function extractPoster(src: string, outFile: string, durationSec: number): Promise<void> {
  const t = Math.max(0, Math.round(durationSec * 0.5));
  const args = ['-y', '-ss', String(t), '-i', src, '-frames:v', '1', '-vf', "scale='min(1280,iw)':'-2'", '-q:v', '2', outFile];
  const { code, stderr } = await execFile('ffmpeg', args);
  if (code !== 0) throw new Error('ffmpeg poster failed: ' + stderr);
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function processSource(file: string, prev: VideoSourceEntry | null): Promise<VideoSourceEntry> {
  const relPublicPath = '/' + path.relative(publicDir, file).replace(/\\/g, '/');
  const basename = path.basename(file).replace(/\.[^.]+$/, '');
  const id = deriveId(file);
  const inputBytes = await fs.readFile(file);
  const signature = 'mp4:crf22:webm:crf33:gop~2s';
  const contentHash = computeHash(inputBytes, signature);

  const meta = await ffprobeMeta(file);
  const heights = targetHeights.filter((h) => h <= meta.height && h > 0);
  if (heights.length === 0) heights.push(Math.max(480, Math.floor(meta.height / 2)));

  const outputs: VideoVariant[] = [];
  const ensureOutputs: Array<Promise<void>> = [];

  for (const h of heights) {
    for (const fmt of supportedFormats) {
      const outName = `${basename}.${contentHash}.${h}p.${fmt}`;
      const outDisk = path.join(videosDir, outName);
      const outUrl = `/videos/${outName}`;
      outputs.push({ format: fmt, codec: fmt === 'mp4' ? 'h264' : 'vp9', width: -1, height: h, url: outUrl });
      const needEncode = !(await pathExists(outDisk));
      if (needEncode || (prev && prev.contentHash !== contentHash)) {
        ensureOutputs.push(encodeVariant(file, outDisk, h, meta.fps, fmt));
      }
    }
  }

  const posterName = `${basename}.${contentHash}.poster.jpg`;
  const posterDisk = path.join(videosDir, posterName);
  const posterUrl = `/videos/${posterName}`;
  const needPoster = !(await pathExists(posterDisk)) || (prev && prev.contentHash !== contentHash);
  if (needPoster) await extractPoster(file, posterDisk, meta.durationSec);

  await Promise.all(ensureOutputs);

  // Probe one variant to fill width/height if needed
  for (const v of outputs) {
    const vPath = path.join(publicDir, v.url.replace(/^\//, ''));
    const vMeta = await ffprobeMeta(vPath).catch(() => ({ width: 0, height: v.height, durationSec: 0, fps: 0 }));
    v.width = vMeta.width || Math.round((meta.width / meta.height) * v.height);
  }

  const entry: VideoSourceEntry = {
    id,
    sourcePath: relPublicPath,
    contentHash,
    width: meta.width,
    height: meta.height,
    durationSec: meta.durationSec,
    variants: outputs,
    poster: { url: posterUrl, width: 0, height: 0, type: 'image/jpeg' }
  };
  return entry;
}

async function writeManifest(manifest: VideoManifest): Promise<void> {
  await safeMkdirp(videosDir);
  const tmp = manifestPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2));
  await fs.rename(tmp, manifestPath);
}

async function main(): Promise<void> {
  const ok = await ensurePrereqs();
  if (!ok) {
    // If strict, exit non-zero. Otherwise, succeed to not block build.
    process.exit(process.env.VIDEO_OPT_STRICT === '1' ? 1 : 0);
  }

  await safeMkdirp(videosDir);
  const prev = (await readJsonIfExists<VideoManifest>(manifestPath)) ?? { pipelineVersion, generatedAt: new Date().toISOString(), sources: [] };
  const sources = await listSourceFiles();

  const newEntries: VideoSourceEntry[] = [];
  for (const src of sources) {
    const id = deriveId(src);
    const prevEntry = prev.sources.find((s) => s.id === id) ?? null;
    const entry = await processSource(src, prevEntry);
    newEntries.push(entry);
  }

  const manifest: VideoManifest = {
    pipelineVersion,
    generatedAt: new Date().toISOString(),
    sources: newEntries
  };
  await writeManifest(manifest);
  console.log(`Video manifest written: ${path.relative(projectRoot, manifestPath)}`);
}

main().catch((err) => {
  console.error('[optimize-videos] Error:', err);
  process.exit(1);
});


