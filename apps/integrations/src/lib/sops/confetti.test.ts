import { describe, expect, it } from 'vitest';
import {
  advance,
  type ConfettiPiece,
  createBurst,
  FADE,
  PALETTE,
  PIECES_PER_CANNON,
  pieceFace,
  pieceOpacity,
  TERMINAL,
} from './confetti';

const WIDTH = 900;
const HEIGHT = 700;
const VIEW = { width: WIDTH, height: HEIGHT };

/** A repeatable stand-in for Math.random, so a burst can be inspected. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

function piece(overrides: Partial<ConfettiPiece> = {}): ConfettiPiece {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    tilt: 0,
    tiltSpin: 0,
    size: 8,
    color: PALETTE[0],
    life: 3,
    ...overrides,
  };
}

describe('createBurst', () => {
  it('fires both cannons, from the bottom corners', () => {
    const pieces = createBurst(WIDTH, HEIGHT, seeded(1));
    expect(pieces).toHaveLength(PIECES_PER_CANNON * 2);
    const left = pieces.filter((p) => p.x === 0);
    const right = pieces.filter((p) => p.x === WIDTH);
    expect(left).toHaveLength(PIECES_PER_CANNON);
    expect(right).toHaveLength(PIECES_PER_CANNON);
    for (const p of pieces) expect(p.y).toBeGreaterThan(HEIGHT * 0.8);
  });

  it('aims every piece inward and upward', () => {
    const pieces = createBurst(WIDTH, HEIGHT, seeded(7));
    for (const p of pieces) {
      expect(p.vy).toBeLessThan(0);
      if (p.x === 0) expect(p.vx).toBeGreaterThan(0);
      else expect(p.vx).toBeLessThan(0);
    }
  });

  it('gives every piece a life, a size and a brand color', () => {
    for (const p of createBurst(WIDTH, HEIGHT, seeded(42))) {
      expect(p.life).toBeGreaterThan(0);
      expect(p.size).toBeGreaterThan(0);
      expect(PALETTE).toContain(p.color);
    }
  });

  it('scales the launch with the viewport, so a tall screen still fills', () => {
    const short = createBurst(WIDTH, 400, seeded(3));
    const tall = createBurst(WIDTH, 1200, seeded(3));
    const fastest = (pieces: ConfettiPiece[]) => Math.min(...pieces.map((p) => p.vy));
    expect(fastest(tall)).toBeLessThan(fastest(short));
  });
});

describe('advance', () => {
  it('pulls pieces down and carries them along', () => {
    const [next] = advance([piece({ vx: 100, vy: 0 })], 0.1, VIEW);
    expect(next.vy).toBeGreaterThan(0);
    expect(next.y).toBeGreaterThan(100);
    expect(next.x).toBeGreaterThan(100);
  });

  it('bleeds off speed rather than letting a piece coast', () => {
    const [next] = advance([piece({ vx: 500 })], 0.1, VIEW);
    expect(next.vx).toBeLessThan(500);
    expect(next.vx).toBeGreaterThan(0);
  });

  it('is frame-rate independent: two half steps land where one full one does', () => {
    const start = piece({ vx: 300, vy: -400 });
    const once = advance([start], 0.2, VIEW)[0];
    const twice = advance(advance([start], 0.1, VIEW), 0.1, VIEW)[0];
    expect(twice.y).toBeCloseTo(once.y, 0);
    expect(twice.x).toBeCloseTo(once.x, 0);
  });

  it('turns each piece on its own two axes', () => {
    const [next] = advance([piece({ spin: 4, tiltSpin: 6 })], 0.5, VIEW);
    expect(next.angle).toBeCloseTo(2);
    expect(next.tilt).toBeCloseTo(3);
  });

  it('drops pieces that have run out of life', () => {
    expect(advance([piece({ life: 0.05 })], 0.1, VIEW)).toHaveLength(0);
  });

  it('drops pieces that have fallen past the floor', () => {
    expect(advance([piece({ y: HEIGHT, vy: 800 })], 0.1, VIEW)).toHaveLength(0);
  });

  it('drops pieces that have blown off either side', () => {
    expect(advance([piece({ x: 5, vx: -900 })], 0.1, VIEW)).toHaveLength(0);
    expect(advance([piece({ x: WIDTH - 5, vx: 900 })], 0.1, VIEW)).toHaveLength(0);
  });

  it('keeps a piece still on its way down', () => {
    expect(advance([piece({ y: HEIGHT / 2, vy: 800 })], 0.1, VIEW)).toHaveLength(1);
  });

  it('empties a burst eventually, which is how the animation stops', () => {
    let pieces = createBurst(WIDTH, HEIGHT, seeded(11));
    for (let i = 0; i < 400 && pieces.length > 0; i += 1) {
      pieces = advance(pieces, 1 / 60, VIEW);
    }
    expect(pieces).toHaveLength(0);
  });

  it('throws a burst up the screen and clears it within a few seconds', () => {
    for (const [width, height] of [
      [390, 780],
      [900, 700],
      [1440, 900],
    ]) {
      let pieces = createBurst(width, height, seeded(width));
      let peak = height;
      let frames = 0;
      while (pieces.length > 0 && frames < 600) {
        pieces = advance(pieces, 1 / 60, { width, height });
        for (const p of pieces) peak = Math.min(peak, p.y);
        frames += 1;
      }
      // Well into the top half of whatever screen it is fired on, without
      // spending the burst somewhere above it.
      expect(peak).toBeLessThan(height / 2);
      expect(peak).toBeGreaterThan(-height * 0.15);
      expect(frames).toBeLessThan(300);
    }
  });

  it('leaves a burst alone on a step of no time at all', () => {
    const pieces = createBurst(WIDTH, HEIGHT, seeded(5));
    expect(advance(pieces, 0, VIEW)).toBe(pieces);
  });

  it('settles a fall at terminal speed rather than accelerating forever', () => {
    let falling = [piece({ y: -5000, vy: 0, life: 60 })];
    for (let i = 0; i < 300; i += 1) falling = advance(falling, 1 / 60, VIEW);
    expect(falling[0].vy).toBeLessThanOrEqual(TERMINAL);
    expect(falling[0].vy).toBeCloseTo(TERMINAL, 0);
  });
});

describe('pieceOpacity', () => {
  it('holds full strength until the fade at the end', () => {
    expect(pieceOpacity(piece({ life: 2 }))).toBe(1);
    expect(pieceOpacity(piece({ life: FADE }))).toBe(1);
  });

  it('fades out over the last of a life, never below nothing', () => {
    expect(pieceOpacity(piece({ life: FADE / 2 }))).toBeCloseTo(0.5);
    expect(pieceOpacity(piece({ life: -1 }))).toBe(0);
  });
});

describe('pieceFace', () => {
  it('shows the ribbon full on when it faces the viewer', () => {
    expect(pieceFace(piece({ tilt: 0 }))).toBeCloseTo(1);
  });

  it('leaves a sliver when it turns edge-on, so it never blinks out', () => {
    expect(pieceFace(piece({ tilt: Math.PI / 2 }))).toBeCloseTo(0.15);
  });
});
