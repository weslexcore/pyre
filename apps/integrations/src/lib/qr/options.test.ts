import { describe, expect, it } from 'vitest';
import { qrGeometry } from './options';

describe('qrGeometry', () => {
  it('lands the quiet zone exactly on the module', () => {
    const g = qrGeometry(4, { type: 'canvas', target: 240, modules: 29 });
    expect(g.moduleSize).toBe(6); // floor(240 / 37)
    expect(g.width).toBe(37 * 6);
    expect(g.margin).toBe(4 * 6);
    expect((g.width - 2 * g.margin) / g.moduleSize).toBe(29);
  });

  it('gives every quiet zone value a different border', () => {
    const margins = [0, 1, 2, 3, 4].map(
      (q) => qrGeometry(q, { type: 'canvas', target: 1200, modules: 29 }).margin
    );
    expect(new Set(margins).size).toBe(margins.length);
  });

  it('never drops below one unit per module', () => {
    expect(qrGeometry(8, { type: 'svg', target: 10, modules: 177 }).moduleSize).toBe(1);
  });
});
