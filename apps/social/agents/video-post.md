# Skill: video / reel / animated post (MP4)

**Use this when:** any export entry uses `format: 'mp4'`. If the post is also a new authored piece, read `create-post.md` first for the file scaffolds. This skill covers only the MP4-specific concerns.

## How video export works

1. Playwright opens the post in a headless Chromium tab sized to the target resolution (e.g. 1080 × 1920 for `reel`).
2. After `networkidle` + fonts ready + optional `settleMs`, recording starts and runs for `duration` ms.
3. The resulting `.webm` is transcoded by ffmpeg to H.264 MP4: `yuv420p`, 30fps, `+faststart`. This is the format Instagram accepts cleanly.

Implementation lives in `scripts/lib/render-video.ts` if you need to inspect the pipeline.

## `post.config.ts` for video

```ts
import { defineConfig } from '../../scripts/lib/config.ts';

export default defineConfig({
  name: '<post-slug>',
  exports: [
    { size: 'reel', format: 'mp4', duration: 6000 },
    // Mix freely with PNG exports — they share the same post:
    { size: 'square', format: 'png' },
  ],
  settleMs: 200, // optional, see below
});
```

- **`duration`** (per-entry, ms) — total wall-clock recording length. Default is **5000 ms** if omitted. Set this to match your animation's wall-clock length.
- **`settleMs`** (top-level, ms) — delay between navigation completing and recording starting. Default 0. Use this to skip past a one-shot entrance animation before the loop begins recording.

## Animation rules

- **Pure CSS or `<video>`.** CSS keyframes and `<video autoplay loop muted playsinline>` both play during recording. JS-driven animation (`requestAnimationFrame`, GSAP, etc.) works in principle but is fragile under headless Chromium timing — avoid unless necessary.
- **Design for autoplay loop.** Instagram loops reels and video carousel slides. Make the end frame match (or smoothly cross into) the start frame so the loop seam is invisible.
- **`animation-iteration-count: infinite` is fine.** The recording captures whatever motion happens during the `duration` window.
- **Avoid `animation-delay` for entrance flourishes** — by the time the delay fires, the recording has already started. Use `settleMs` instead to push the start of recording past the entrance.

## Working pattern: animated background

From `posts/example-summer-launch/style.css` — a pure-CSS "aurora" that drifts continuously, perfect for video loops:

```css
.aurora {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(ellipse at 20% 30%, var(--pyre-red) 0%, transparent 55%),
    radial-gradient(ellipse at 80% 70%, var(--pyre-gold) 0%, transparent 55%),
    radial-gradient(ellipse at 50% 50%, var(--pyre-blue) 0%, transparent 60%);
  filter: blur(60px) saturate(1.2);
  opacity: 0.55;
  animation: aurora-drift 8s ease-in-out infinite alternate;
}

@keyframes aurora-drift {
  0%   { transform: translate3d(-4%, -2%, 0) scale(1.05); }
  100% { transform: translate3d(4%, 3%, 0) scale(1.15); }
}
```

`ease-in-out … alternate` ensures motion eases at both endpoints, which makes any tail of the recording look natural even if `duration` doesn't divide the cycle evenly.

## Picking `duration`

| Animation cycle | Recommended `duration` |
| --- | --- |
| 4s loop | 8000 (two full cycles) |
| 6–8s loop | 6000–8000 (one full cycle is enough) |
| Static + slow drift | 5000 (default) is fine |

Longer recordings produce larger files and slower exports. Don't go past 15s without a reason — Instagram's reel format doesn't reward longer clips here.

## Multi-page + MP4

If `pages: N` is set, each page renders as its own MP4. Output filenames: `reel-1.mp4`, `reel-2.mp4`, etc. Each recording is independent — animations restart from frame 0 on every page.

When `pages > 1`, the renderer also concatenates the per-page files into a single combined MP4: `<post-name>-<size>.mp4` (e.g. `cold-plunge-for-beginners-reel.mp4`). This is what you upload to Instagram as the reel. Concat is done with ffmpeg's `concat` demuxer in stream-copy mode, so it's fast and lossless — no re-encoding. Per-page files are kept alongside the combined file.

In the preview UI, **Export all** triggers the join automatically after every per-page render succeeds. If any per-page render fails, the join is skipped for that entry.

## Verification after export

1. Open the MP4 in QuickTime (or `open exports/<slug>/reel-1.mp4`).
2. The **first frame** should already look "settled" — no half-loaded fonts, no off-screen elements mid-entrance.
3. The **last frame** should match (or visually flow into) the first frame for a clean loop.
4. Total duration should match `duration` ± ~100ms.

## Gotchas

- **First frame is mid-animation.** Increase `settleMs`, or restructure the animation so the at-rest state *is* the first frame.
- **Last frame jumps back to start.** That's the loop seam. Use `alternate` or design the animation so `0%` and `100%` keyframes are visually identical.
- **MP4 file is huge.** `crf 18` + `preset slow` (the configured encoder settings) produce visually lossless output, which is correct for Instagram but can be 10–20 MB for a 6s reel. That's expected.
- **Playwright is missing.** First-time setup: `yarn workspace @pyre/social playwright install chromium`.
