### 1. Project overview / description
Ensure videos in `public/videos/` are optimized for use as background elements. Provide a reusable, automated optimization pipeline that produces lightweight, high‑quality variants and runs during the build when new or changed source videos are detected.

### 2. Target audience
- **Developers / maintainers**: Need a consistent, automated way to prepare background videos.
- **Content editors**: Can drop source videos into `public/videos/` without manual processing.
- **Site visitors (mobile & desktop)**: Benefit from fast‑loading, smooth, looped background playback with minimal CPU/battery impact.

### 3. Primary benefits / features
- **Automated multi‑format output**: Generate MP4 (H.264) and WebM (VP9; optionally AV1 when available) for broad compatibility.
- **Multiple resolutions / bitrates**: 1080p, 720p, 480p (and optional 2160p if source is high‑res) using CRF‑based VBR targets to balance quality and size.
- **Background‑ready defaults**: Strip audio by default, align keyframes for clean loops, set moov atom to the front for fast start.
- **Poster & preview assets**: Extract poster frames (`.jpg`/`.webp`) and small preview clips for graceful fallbacks.
- **Deterministic naming & manifest**: Content‑hashed filenames and a `videos.manifest.json` capturing variants, checksums, dimensions, and last‑modified; skip work if outputs are up‑to‑date.
- **Build integration**: Optimization runs automatically as part of the build if any unoptimized/changed sources are present; CI‑friendly and cacheable.
- **Quality safeguards**: Sensible CRF caps, bitrate floors/ceilings, and optional SSIM/PSNR sampling to avoid visible quality loss.

### 4. High‑level tech/architecture used
- **Tooling**: `ffmpeg` CLI orchestrated via a Node script (TypeScript) to scan and process `public/videos/`.
- **Script**: `scripts/optimize-videos.ts` reads source files (`.mov`, `.mp4`, etc.), computes checksums, and emits variants + manifest.
- **Encoding**:
  - MP4/H.264 (baseline/High profile as appropriate) with AAC removed (muted background) and `-movflags +faststart`.
  - WebM/VP9 (and AV1 when available in the environment) with Opus removed (muted) and carefully tuned `-crf`/`-b:v`.
  - Keyframe interval ~1–2s for smooth loops; `-pix_fmt yuv420p` for compatibility.
- **Assets**: Generate poster at a representative mid‑scene frame and optional tiny preview clip.
- **Manifest**: `public/videos/videos.manifest.json` maps each source to its variants, poster, dimensions, duration, and content hash; used by components/utilities at runtime/build time.
- **Build hook**: Add an npm `prebuild` step to run the optimizer; skip when manifest and outputs are current. CI uses the same step for reproducibility.
- **Usage**: Components render `<video>` with `muted playsinline autoplay loop` and `<source>` entries for WebM then MP4, picking an appropriate resolution based on container size or media queries.


