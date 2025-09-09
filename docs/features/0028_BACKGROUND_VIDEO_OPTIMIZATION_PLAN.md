## Background Video Optimization Pipeline

Brief: Ensure videos in `public/videos/` are optimized for use as background elements. Provide a reusable, automated optimization pipeline that produces lightweight, high‑quality variants and runs during the build when new or changed source videos are detected.

### Scope and objectives
- Optimize raw sources in `public/videos/` into multiple formats/resolutions suitable for background playback.
- Automate via a Node TypeScript script that orchestrates `ffmpeg`/`ffprobe` and emits a manifest for use in components.
- Integrate into the build so the pipeline runs as a prebuild step and skips work when nothing changed.

### Files to create/update
- New: `scripts/optimize-videos.ts`
  - TypeScript Node script that scans `public/videos/`, generates variants/posters, and writes a manifest.
- New (generated at runtime): `public/videos/videos.manifest.json`
  - Deterministic manifest mapping each source to its optimized variants, poster, dimensions, duration, and content hash.
- Update: `package.json`
  - Add `optimize:videos` script (runs the TS script via a runner) and update `prebuild` to invoke it.
  - Add dev dependency for a TS runner (e.g., `tsx`) if not present; no runtime deps required.
- New: `src/lib/videos.ts`
  - Small helper utilities to resolve variants from the manifest for components and pick a default resolution.
- Update: `src/lib/types.ts`
  - Add `VideoManifest`, `VideoSourceEntry`, `VideoVariant`, and `VideoPoster` types.
- Update: `src/components/ExperiencesSection.astro`
  - Replace the single `src={withBase('/videos/running_water.MOV')}` with multi‑source `<source>` entries (WebM then MP4) driven by the manifest, plus `poster` attribute. Keep existing accessibility and reduced‑motion behaviors.
- Docs: `README.md` (optional)
  - Note ffmpeg/ffprobe requirement and how to run `yarn optimize:videos` locally. CI notes for installing ffmpeg.

### Source discovery and skipping rules
- Source directory: `public/videos/`
- Consider as sources: case‑insensitive `*.mov`, `*.mp4`, `*.m4v`, `*.webm`, `*.mkv`.
- Ignore already‑generated outputs: files matching `*.{webm,mp4,jpg,webp}` that include our content hash and resolution suffix (see naming below), and `videos.manifest.json`.
- Skip processing when all target outputs for a source exist, are newer than the source, and the manifest entry’s `contentHash` and `pipelineVersion` match the current settings.

### Output formats, resolutions, and naming
- Formats: MP4/H.264 and WebM/VP9. Optionally enable AV1 when `ffmpeg -codecs` shows `libaom-av1` is available.
- Resolutions (max): 1080p, 720p, 480p. Only generate resolutions ≤ source height; if the source is <720p, generate just 480p (or the nearest downscale).
- Framerate: preserve input FPS.
- Keyframe interval: target ~2s GOP size (e.g., `-g ≈ 2 * fps`, `-keyint_min ≈ g`) for smooth loops.
- Pixel format: `yuv420p` for compatibility.
- Audio: strip (`-an`).
- MP4/H.264 encoding (example tuning):
  - `-c:v libx264 -profile:v high -preset medium -pix_fmt yuv420p -movflags +faststart -crf 22` (allow tweaking CRF 20–24).
- WebM/VP9 encoding (example tuning):
  - `-c:v libvpx-vp9 -b:v 0 -crf 33 -row-mt 1 -threads N -pix_fmt yuv420p -g <gop>` (allow `-speed 2` for faster CI builds).
- Poster image: mid‑scene frame at 40–60% of duration; emit `.jpg` (or `.webp` if preferred) at a sensible width (e.g., 1280px max).
- Optional preview clip: 2–3s loopable preview at 480p VP9 for low‑bandwidth fallbacks.
- Deterministic naming: `${basename}.${contentHash}.${height}p.${ext}` for videos; `${basename}.${contentHash}.poster.jpg` for poster; `${basename}.${contentHash}.preview.webm` for preview.

### Manifest schema (written to `public/videos/videos.manifest.json`)
- Top‑level object with `pipelineVersion`, `generatedAt`, and `sources: VideoSourceEntry[]`.
- `VideoSourceEntry` fields:
  - `id`: stable ID derived from base filename (e.g., `running_water`).
  - `sourcePath`: original public path (e.g., `/videos/running_water.MOV`).
  - `contentHash`: SHA‑256 (or similar) of source bytes plus encoder settings signature.
  - `width`, `height`, `durationSec` (from `ffprobe`).
  - `variants: VideoVariant[]` where each variant has `format`, `codec`, `width`, `height`, `bitrateKbps?`, and `url` (public path).
  - `poster?: { url, width, height, type }`.
  - `preview?: { url, durationSec }`.

### Script behavior (`scripts/optimize-videos.ts`)
1) Preflight
   - Detect `ffmpeg` and `ffprobe` availability. If missing, print a clear warning and exit with non‑zero (CI) or skip (local) based on an env flag (e.g., `VIDEO_OPT_STRICT=1`).
   - Read any existing `videos.manifest.json` for incremental behavior.
2) Scan and hash
   - Recursively scan `public/videos/` for supported source extensions.
   - Compute a `contentHash = sha256(fileBytes + pipelineVersion + encoderSettingsSignature)`.
   - Use `ffprobe -v error -show_streams -of json` to get width/height/fps/duration.
3) Plan outputs per source
   - Determine target heights ≤ source height from [1080, 720, 480].
   - For each height, plan MP4/H.264 and WebM/VP9 outputs with deterministic filenames.
   - Plan poster and optional preview.
4) Up‑to‑date check
   - If all planned outputs exist on disk and the prior manifest entry matches `contentHash` and `pipelineVersion`, skip re‑encoding.
5) Encode
   - Run `ffmpeg` for each planned variant with the tunings above, scaling via `-vf scale=-2:<height>` to preserve aspect ratio.
   - Strip audio (`-an`) and add `-movflags +faststart` for MP4.
   - Use a shared GOP calculation based on probed FPS (e.g., `gop = round(2 * fps)`).
6) Poster and preview
   - Poster: `ffmpeg -ss <midpoint> -i <src> -frames:v 1 -vf scale='min(1280,iw):-2' -q:v 2 <poster>`.
   - Preview (optional): `ffmpeg -t 3 -i <src> -c:v libvpx-vp9 -b:v 0 -crf 35 -vf scale=-2:480 <preview.webm>`.
7) Write manifest
   - Update/insert the entry for the source with all outputs and metadata; write atomically to `videos.manifest.json`.

### Build integration
- `package.json` scripts:
  - Add: `"optimize:videos": "tsx scripts/optimize-videos.ts"` (or `node --loader tsx` variant). If `tsx` is unavailable, use `ts-node` equivalently.
  - Update: `"prebuild"` to chain the optimizer before existing checks, e.g., `"prebuild": "yarn optimize:videos && yarn run check:no-daisyui"`.
- CI:
  - Ensure `ffmpeg`/`ffprobe` are installed (e.g., `brew install ffmpeg` on macOS runners or apt on Ubuntu). Cache `public/videos/*.{mp4,webm,jpg,webp}` and `videos.manifest.json` keyed by source hashes where possible.

### Component usage (`src/components/ExperiencesSection.astro`)
- Replace the single `src` MOV reference with multiple `<source>` elements from the manifest:
  - Prefer WebM first, then MP4, defaulting to a mid‑tier resolution (e.g., 720p) when selecting a single variant.
  - Provide `poster` from the manifest and keep `autoplay muted loop playsinline preload="metadata"`.
- Add a minimal helper in `src/lib/videos.ts`:
  - `getVideoById(id)` → returns the `VideoSourceEntry` from the manifest.
  - `pickVariant(entry, { preferredHeight })` → chooses the best variant ≤ container size; default to 720p.
- Preserve reduced‑motion behavior and intersection observer logic already present.

### Quality safeguards
- CRF ranges: MP4 (20–24), VP9 (30–36). Clamp extremes to avoid visible artifacts.
- Bitrate floors/ceilings: allow minimums (e.g., ≥ 600 kbps at 480p) to prevent excessive smoothing.
- Optional: sample a few frames for SSIM/PSNR checks in debug mode and warn if quality drops below thresholds.

### Developer experience
- Local run: `yarn optimize:videos` after adding or changing videos under `public/videos/`.
- If `ffmpeg` is missing locally, print installation guidance and skip (unless `VIDEO_OPT_STRICT=1`).
- The site can continue to work with the existing MOV during initial adoption; once variants are generated and the component is updated, the MOV should only remain as the source artifact, not a served format.


