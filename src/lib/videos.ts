import { withBase } from './paths';
import type { VideoManifest, VideoSourceEntry, VideoVariant } from './types';

// The manifest is emitted to public/videos/videos.manifest.json by the optimizer.
// During dev/build it is statically served from the public directory.
function loadManifestSafely(): VideoManifest | null {
  try {
    // Vite/Astro will copy from public/ at the root of the site
    const path = '/videos/videos.manifest.json';
    // @ts-ignore - Importing JSON at runtime; at build, this is served as a static asset.
    return undefined as unknown as VideoManifest; // Placeholder for type-only import
  } catch {
    return null;
  }
}

// We cannot import JSON statically from public/, so we provide a runtime fetch wrapper.
let cachedManifest: Promise<VideoManifest | null> | null = null;
export async function getVideoManifest(): Promise<VideoManifest | null> {
  if (!cachedManifest) {
    cachedManifest = (async () => {
      try {
        const res = await fetch(withBase('/videos/videos.manifest.json'), { cache: 'no-cache' });
        if (!res.ok) return null;
        const data = (await res.json()) as VideoManifest;
        return data;
      } catch {
        return null;
      }
    })();
  }
  return cachedManifest;
}

export async function getVideoById(id: string): Promise<VideoSourceEntry | null> {
  const manifest = await getVideoManifest();
  if (!manifest) return null;
  return manifest.sources.find((s) => s.id === id) ?? null;
}

export function pickVariant(
  entry: VideoSourceEntry,
  opts?: { preferredHeight?: number }
): VideoVariant | null {
  const preferred = opts?.preferredHeight ?? 720;
  const webm = entry.variants
    .filter((v) => v.format === 'webm' && v.height <= preferred)
    .sort((a, b) => b.height - a.height)[0];
  if (webm) return webm;
  const mp4 = entry.variants
    .filter((v) => v.format === 'mp4' && v.height <= preferred)
    .sort((a, b) => b.height - a.height)[0];
  return mp4 ?? null;
}

export function getOrderedSources(entry: VideoSourceEntry): Array<VideoVariant> {
  // Prefer WebM first, then MP4, high to low heights
  const byFormat = (format: string) => entry.variants.filter((v) => v.format === format);
  const sortDesc = (a: VideoVariant, b: VideoVariant) => b.height - a.height;
  return [...byFormat('webm').sort(sortDesc), ...byFormat('mp4').sort(sortDesc)];
}


