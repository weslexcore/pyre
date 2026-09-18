// The celebration that pops when a checklist is finished — a full-screen
// canvas of paper, fired from the bottom corners, that clears itself away
// once the last piece has fallen. The arithmetic lives in lib/sops/confetti;
// this owns the canvas, the animation frames and the mount.
//
// It is driven by a counter rather than a boolean: ChecklistView bumps `burst`
// each time a run reaches the end, so finishing, un-checking an item and
// finishing again pops again — and a burst that lands while one is still in
// the air adds to it instead of interrupting it.
//
// Nothing renders until the first burst (the canvas mounts with it and
// unmounts after it), so the server-rendered checklist is untouched and an
// idle page carries no full-screen element. Staff who ask for less motion get
// none of it: the notice in the header still says the run is complete.
import { useEffect, useRef, useState } from 'react';
import {
  advance,
  type ConfettiPiece,
  createBurst,
  MAX_FRAME,
  pieceFace,
  pieceOpacity,
} from '@/lib/sops/confetti';

/** Above the peek modal (z-50) — a checklist finished in there celebrates too. */
const LAYER_CLASS = 'pointer-events-none fixed inset-0 z-[60]';

/** Retina is worth it; past 2x is pure fill rate for paper nobody inspects. */
const MAX_DPR = 2;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Match the backing store to the element, and draw in CSS pixels. */
function measure(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);
  // Assigning either dimension wipes the canvas, so only do it on a real
  // change (a rotation, a window resize) rather than every frame.
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function draw(ctx: CanvasRenderingContext2D, piece: ConfettiPiece) {
  const height = piece.size * 0.62 * pieceFace(piece);
  ctx.save();
  ctx.globalAlpha = pieceOpacity(piece);
  ctx.translate(piece.x, piece.y);
  ctx.rotate(piece.angle);
  ctx.fillStyle = piece.color;
  ctx.fillRect(-piece.size / 2, -height / 2, piece.size, height);
  ctx.restore();
}

export function Confetti({ burst }: { burst: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [flying, setFlying] = useState(false);
  // Bursts asked for but not yet spawned — the running loop picks them up on
  // its next frame, which is also the first frame the canvas exists.
  const queued = useRef(0);
  const pieces = useRef<ConfettiPiece[]>([]);

  useEffect(() => {
    if (burst === 0 || prefersReducedMotion()) return;
    queued.current += 1;
    setFlying(true);
  }, [burst]);

  // Keyed on the burst as well as the canvas being up: a burst that arrives
  // in the same frame the previous one ended still restarts the loop, even
  // though `flying` never visibly changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: burst is the restart, not a value this reads
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!flying || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setFlying(false);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      const view = measure(canvas, ctx);
      while (queued.current > 0) {
        queued.current -= 1;
        pieces.current = pieces.current.concat(createBurst(view.width, view.height));
      }
      pieces.current = advance(pieces.current, dt, view);
      ctx.clearRect(0, 0, view.width, view.height);
      for (const piece of pieces.current) draw(ctx, piece);
      // Out of paper: take the canvas back down until the next one.
      if (pieces.current.length === 0) {
        setFlying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [flying, burst]);

  if (!flying) return null;
  // The paper is decoration over a run whose header already says it is done,
  // so the whole layer is hidden from assistive tech.
  return (
    <div aria-hidden="true" className={LAYER_CLASS}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
