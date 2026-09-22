// The little celebration a form can pop when it is sent, switched on per
// form in the builder. Drawn rather than installed: one canvas, a few dozen
// paper rectangles under gravity, about two seconds, and then the whole
// thing takes itself down.
//
// It falls across the whole page, not the form: the canvas goes out to the
// body through a portal, because `position: fixed` is only the viewport
// while no ancestor has claimed it — and the form's panel does, with the
// backdrop-blur it wears over a background image. Inside the form it was a
// burst in a box.
//
// It is decoration and nothing else — out of the accessibility tree, out of
// the way of the pointer, and never over the thank-you it celebrates. Under
// a reduced-motion preference it does not run at all: the burst is exactly the kind of
// unprompted movement that setting is asking us not to make. Nothing is
// drawn on the server either, so the page that arrives is the page that
// paints.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** The brand, as canvas wants it. Mirrors the variables in styles/admin.css. */
const COLORS = ['#f5f1e9', '#d15232', '#dbb155', '#839770', '#274868'];

const PIECES = 90;
/** How long the whole thing lasts, and how long it spends fading out. */
const LIFE_MS = 2200;
const FADE_MS = 600;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  width: number;
  height: number;
  color: string;
}

/** A burst from the top of the panel, thrown up and out, then falling. */
function makePieces(width: number, height: number): Piece[] {
  const originX = width / 2;
  const originY = height * 0.35;
  return Array.from({ length: PIECES }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 7;
    return {
      x: originX + (Math.random() - 0.5) * width * 0.2,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      width: 6 + Math.random() * 6,
      height: 3 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });
}

export function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The body, once there is one: the server has no document, and the first
  // client render has to paint what the server painted.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  useEffect(() => {
    // Nothing to draw on until the portal has somewhere to go.
    if (!host) return;
    const element = canvas.current;
    if (!element) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const context = element.getContext('2d');
    if (!context) return;

    const scale = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    element.width = Math.round(width * scale);
    element.height = Math.round(height * scale);
    context.scale(scale, scale);

    const pieces = makePieces(width, height);
    const start = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const elapsed = now - start;
      context.clearRect(0, 0, width, height);
      // The last stretch fades, so nothing vanishes mid-air.
      context.globalAlpha = Math.max(0, Math.min(1, (LIFE_MS - elapsed) / FADE_MS));

      for (const piece of pieces) {
        piece.vy += 0.22;
        piece.vx *= 0.99;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.angle += piece.spin;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.color;
        context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
        context.restore();
      }

      if (elapsed < LIFE_MS) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [host]);

  if (!host) return null;
  // The canvas is wrapped rather than hidden in place: a <canvas> can hold
  // interactive content, so it is the container that is taken out of the
  // accessibility tree and the canvas simply sits inside it.
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
      <canvas ref={canvas} className="h-full w-full" />
    </div>,
    host
  );
}
