// The physics behind the burst that pops when a checklist is finished: where a
// burst's pieces start, and how each one moves from one frame to the next.
// Kept free of React, the DOM and the canvas so it can be tested directly —
// Confetti.tsx owns the canvas and the animation frames.
//
// Two cannons fire inward and upward from the bottom corners of the viewport,
// which reads as a celebration without ever burying the middle of the screen
// where the checklist's own "Completed" header just turned sage. Each piece is
// a small ribbon: it carries its own spin (how it lies on the screen) and its
// own tilt (how far it has turned edge-on), so a burst flickers the way paper
// does instead of drifting like a sheet of dots.

/** A single ribbon in flight. Positions are viewport px, speeds px per second. */
export interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  /** Positive is downward, matching canvas coordinates. */
  vy: number;
  /** How the ribbon lies on the screen, in radians, and how fast it turns. */
  angle: number;
  spin: number;
  /** How far the ribbon has turned edge-on, in radians, and how fast (see pieceFace). */
  tilt: number;
  tiltSpin: number;
  /** Width of the ribbon in px. */
  size: number;
  /** A canvas fill — a literal color, since a canvas can't read a CSS variable. */
  color: string;
  /** Seconds this piece has left before it is dropped. */
  life: number;
}

/** The brand palette, minus the blue — it disappears against the admin's dark page. */
export const PALETTE = ['#dbb155', '#839770', '#d15232', '#f5f1e9'];

/** The fraction of its speed a piece keeps per second — paper does not coast. */
export const DRAG = 0.2;

/** How fast a piece settles into falling, px/s: slow enough to flutter down. */
export const TERMINAL = 520;

/** How quickly drag bleeds speed off, per second — DRAG said as a rate. */
const K = -Math.log(DRAG);

/** Downward pull, px/s²: whatever it takes to reach TERMINAL against DRAG. */
export const GRAVITY = TERMINAL * K;

/** Pieces per cannon; two cannons fire per burst. */
export const PIECES_PER_CANNON = 34;

/** Seconds of fade at the end of a piece's life. */
export const FADE = 0.9;

/**
 * The longest step advance() should ever be asked for. A backgrounded tab
 * hands back one enormous frame on its return, which without this would
 * teleport the whole burst through the floor.
 */
export const MAX_FRAME = 1 / 20;

/**
 * How hard the cannons fire, as a multiple of the speed that would just reach
 * the top of the screen with no air in the way. Drag eats a good half of it,
 * which puts the peak of a burst around four fifths of the way up.
 */
const LAUNCH = 1.5;

const LIFE = [2.4, 3.8];
const SIZE = [5, 11];
/** Aim above the horizontal, in radians: 60° to 85°, always inward. */
const AIM = [1.05, 1.48];
/** The share of the full launch speed a piece gets. */
const POWER = [0.55, 1];

function between(random: () => number, range: number[]): number {
  return range[0] + random() * (range[1] - range[0]);
}

/**
 * A fresh burst for a viewport of this size: two cannons' worth of pieces,
 * already in the air. `random` is injectable so the physics can be tested
 * against a known sequence.
 */
export function createBurst(
  width: number,
  height: number,
  random: () => number = Math.random
): ConfettiPiece[] {
  const speed = LAUNCH * Math.sqrt(2 * GRAVITY * height);
  const pieces: ConfettiPiece[] = [];
  // -1 is the cannon on the left edge, firing right; 1 is its mirror.
  for (const cannon of [-1, 1]) {
    for (let i = 0; i < PIECES_PER_CANNON; i += 1) {
      const aim = between(random, AIM);
      const power = between(random, POWER) * speed;
      pieces.push({
        x: cannon === -1 ? 0 : width,
        // Spread along the bottom edge so the two streams have some depth.
        y: height * between(random, [0.82, 0.98]),
        vx: Math.cos(aim) * power * -cannon,
        vy: -Math.sin(aim) * power,
        angle: random() * Math.PI * 2,
        spin: between(random, [-9, 9]),
        tilt: random() * Math.PI * 2,
        tiltSpin: between(random, [3, 11]),
        size: between(random, SIZE),
        color: PALETTE[Math.floor(random() * PALETTE.length)] ?? PALETTE[0],
        life: between(random, LIFE),
      });
    }
  }
  return pieces;
}

/** The screen a burst is flying across, in CSS px. */
export interface ConfettiView {
  width: number;
  height: number;
}

/**
 * The burst one step later. Pieces that have run out of life, or left the
 * screen for good — past the bottom, or out either side — are dropped; a
 * burst ends by emptying itself, which is how the animation knows to stop.
 *
 * Drag under gravity has a closed form, and this steps it exactly rather than
 * adding a little each frame: a burst then flies the same path on a 60Hz
 * phone, a 120Hz one, and a frame the browser was late with.
 */
export function advance(pieces: ConfettiPiece[], dt: number, view: ConfettiView): ConfettiPiece[] {
  if (dt <= 0) return pieces;
  // What a speed decays to over the step, and the distance covered decaying.
  const decay = Math.exp(-K * dt);
  const drift = (1 - decay) / K;
  const next: ConfettiPiece[] = [];
  for (const piece of pieces) {
    const life = piece.life - dt;
    // Vertically the piece chases TERMINAL; the gap to it is what decays.
    const gap = piece.vy - TERMINAL;
    const y = piece.y + TERMINAL * dt + gap * drift;
    const x = piece.x + piece.vx * drift;
    // Drag means nothing that has left sideways is coming back.
    if (life <= 0 || y > view.height + piece.size) continue;
    if (x < -piece.size || x > view.width + piece.size) continue;
    next.push({
      ...piece,
      x,
      y,
      vx: piece.vx * decay,
      vy: gap * decay + TERMINAL,
      angle: piece.angle + piece.spin * dt,
      tilt: piece.tilt + piece.tiltSpin * dt,
      life,
    });
  }
  return next;
}

/** How solid a piece should be drawn: full strength until it fades out at the end. */
export function pieceOpacity(piece: ConfettiPiece): number {
  if (piece.life >= FADE) return 1;
  return Math.max(0, piece.life / FADE);
}

/**
 * The share of its height a ribbon shows at this tilt — 1 lying flat toward
 * the viewer, a sliver when it has turned edge-on. It never reaches zero, so
 * a piece can't blink out of existence mid-flight.
 */
export function pieceFace(piece: ConfettiPiece): number {
  return 0.15 + 0.85 * Math.abs(Math.cos(piece.tilt));
}
