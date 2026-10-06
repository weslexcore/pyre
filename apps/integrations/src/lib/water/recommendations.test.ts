// The dosing engine is the one piece of this feature where a wrong number has
// physical consequences (chemicals in guest water), so every chart row and
// boundary gets pinned down here.

import { describe, expect, it } from 'vitest';
import { PRODUCTS, scaleGrams, shockDoses } from './charts';
import { classifyReading, getGuestSafety, getRecommendations } from './recommendations';

const only = (
  readings: Parameters<typeof getRecommendations>[0],
  options?: Parameters<typeof getRecommendations>[1]
) => {
  const recs = getRecommendations(readings, options);
  expect(recs).toHaveLength(1);
  return recs[0];
};

describe('getRecommendations', () => {
  it('returns nothing when all readings are in range', () => {
    expect(getRecommendations({ ta: 100, ph: 7.4, chlorine: 2, salt: 2300 })).toEqual([]);
  });

  it('returns nothing for empty or null readings', () => {
    expect(getRecommendations({})).toEqual([]);
    expect(getRecommendations({ ta: null, ph: null, chlorine: null, salt: null })).toEqual([]);
  });

  describe('TA (house target 80–120)', () => {
    it.each([
      [70, 23],
      [55, 46],
      [40, 70],
      [25, 92],
    ])('doses the chart row: TA %d → %d g Cold Water Balance', (reading, grams) => {
      const rec = only({ ta: reading });
      expect(rec).toMatchObject({
        parameter: 'ta',
        severity: 'action',
        chemical: PRODUCTS.taRaise,
        grams,
      });
    });

    it('does not fire on chart rows inside the house target (100, 85)', () => {
      expect(getRecommendations({ ta: 100 })).toEqual([]);
      expect(getRecommendations({ ta: 85 })).toEqual([]);
    });

    it('uses the nearest row between chart rows', () => {
      expect(only({ ta: 75 }).grams).toBe(23); // nearest 70
      expect(only({ ta: 78 }).grams).toBe(12); // nearest 85
    });

    it('takes the smaller dose on an exact tie', () => {
      expect(only({ ta: 77.5 }).grams).toBe(12); // 70 vs 85 equidistant
    });

    it('is info-only above target (no lowering chart)', () => {
      const rec = only({ ta: 150 });
      expect(rec).toMatchObject({ parameter: 'ta', severity: 'info', chemical: null, grams: null });
    });
  });

  describe('pH (house target 7.2–7.8)', () => {
    it.each([
      [7.9, 10],
      [8.0, 14],
      [8.1, 18],
      [8.2, 23],
    ])('doses the lowering chart row: pH %d → %d g Cold Water Run Down', (reading, grams) => {
      const rec = only({ ph: reading });
      expect(rec).toMatchObject({
        parameter: 'ph',
        severity: 'action',
        chemical: PRODUCTS.phLower,
        grams,
      });
    });

    it('clamps far-high readings to the 8.2 row', () => {
      expect(only({ ph: 8.6 }).grams).toBe(23);
    });

    it('does not fire on lowering rows inside the house target (7.7, 7.8)', () => {
      expect(getRecommendations({ ph: 7.7 })).toEqual([]);
      expect(getRecommendations({ ph: 7.8 })).toEqual([]);
    });

    it.each([
      [7.1, 6],
      [7.0, 7],
      [6.9, 10],
      [6.8, 11],
    ])('doses the raising chart row: pH %d → %d g Cold Water Jump', (reading, grams) => {
      const rec = only({ ph: reading });
      expect(rec).toMatchObject({
        parameter: 'ph',
        severity: 'action',
        chemical: PRODUCTS.phRaise,
        grams,
      });
    });

    it('clamps off-chart low readings to the 6.8 row and says so', () => {
      const rec = only({ ph: 6.5 });
      expect(rec.grams).toBe(11);
      expect(rec.reason).toContain('below the chart');
    });

    it('takes the smaller dose on an exact tie between lowering rows', () => {
      expect(only({ ph: 7.95 }).grams).toBe(10); // 7.9 vs 8.0 equidistant
    });
  });

  describe('chlorine (target 1–3, hard limit 5)', () => {
    it('doses 7 g sanitizer below 1 ppm', () => {
      for (const reading of [0.9, 0.5, 0]) {
        const rec = only({ chlorine: reading });
        expect(rec).toMatchObject({
          parameter: 'chlorine',
          severity: 'action',
          chemical: PRODUCTS.sanitizer,
          grams: 7,
        });
      }
    });

    it('returns nothing at exactly 1 ppm (in target, no dose)', () => {
      expect(getRecommendations({ chlorine: 1 })).toEqual([]);
    });

    it('is info-only between target max and the hard limit', () => {
      const rec = only({ chlorine: 4 });
      expect(rec).toMatchObject({ parameter: 'chlorine', severity: 'info', grams: null });
    });

    it('is critical (close the tub, no dose) above 5 ppm', () => {
      const rec = only({ chlorine: 6 });
      expect(rec).toMatchObject({
        parameter: 'chlorine',
        severity: 'critical',
        chemical: null,
        grams: null,
      });
      expect(rec.instruction).toContain('CLOSE TUB');
    });
  });

  describe('combined chlorine (shock threshold 0.5)', () => {
    it('returns nothing at or below 0.5 ppm', () => {
      expect(getRecommendations({ cc: 0 })).toEqual([]);
      expect(getRecommendations({ cc: 0.5 })).toEqual([]);
    });

    it('is an info-level shock prompt above 0.5 ppm (no dose)', () => {
      const rec = only({ cc: 1 });
      expect(rec).toMatchObject({ parameter: 'cc', severity: 'info', chemical: null, grams: null });
      expect(rec.reason).toContain('shock');
    });
  });

  describe('salt (target 2200–2500, hard limit 3000)', () => {
    it('doses toward the 2350 midpoint in 24 g / 50 ppm steps, rounded down', () => {
      expect(only({ salt: 2100 }).grams).toBe(120); // floor(250/50) = 5 steps
      expect(only({ salt: 2199 }).grams).toBe(72); // floor(151/50) = 3 steps
      expect(only({ salt: 2100 }).chemical).toBe(PRODUCTS.salt);
    });

    it('is info-only between target max and the hard limit', () => {
      const rec = only({ salt: 2700 });
      expect(rec).toMatchObject({ parameter: 'salt', severity: 'info', grams: null });
    });

    it('is critical (dilute, no dose) above 3000 ppm', () => {
      const rec = only({ salt: 3200 });
      expect(rec).toMatchObject({ parameter: 'salt', severity: 'critical', grams: null });
      expect(rec.instruction).toContain('Drain');
    });
  });

  // House rule: alkalinity buffers pH, so pH dosed against low TA drifts
  // straight back. The engine refuses to dose pH until low TA lands. High TA
  // has no fix, so it never holds pH up.
  describe('low TA gates pH', () => {
    it('blocks a pH-lowering dose while TA is below target', () => {
      const recs = getRecommendations({ ta: 70, ph: 7.9 });
      const ph = recs.find((r) => r.parameter === 'ph');
      expect(ph).toMatchObject({ severity: 'blocked', chemical: null, grams: null });
      expect(ph?.instruction).toContain('DO NOT ADJUST pH');
      expect(ph?.reason).toContain('TA 70 ppm is low');
    });

    it('blocks a pH-raising dose while TA is below target', () => {
      const ph = getRecommendations({ ta: 40, ph: 7.0 }).find((r) => r.parameter === 'ph');
      expect(ph).toMatchObject({ severity: 'blocked', grams: null });
    });

    it('doses pH normally while TA is above target (nothing lowers TA)', () => {
      const recs = getRecommendations({ ta: 150, ph: 8.0 });
      expect(recs.find((r) => r.parameter === 'ph')).toMatchObject({
        severity: 'action',
        chemical: PRODUCTS.phLower,
        grams: 14,
      });
      expect(
        getRecommendations({ ta: 150, ph: 7.0 }).find((r) => r.parameter === 'ph')
      ).toMatchObject({
        severity: 'action',
        chemical: PRODUCTS.phRaise,
      });
    });

    it('carries the TA-first rule on a low-TA recommendation', () => {
      expect(only({ ta: 70 }).instruction).toContain('FIX TOTAL ALKALINITY FIRST');
    });

    it('tells staff high TA needs nothing and to carry on', () => {
      const rec = only({ ta: 150 });
      expect(rec).toMatchObject({ parameter: 'ta', severity: 'info', chemical: null, grams: null });
      expect(rec.instruction).not.toContain('FIX TOTAL ALKALINITY FIRST');
      expect(rec.instruction).toContain('check pH');
    });

    it('doses pH normally once TA is in range', () => {
      const recs = getRecommendations({ ta: 100, ph: 7.9 });
      expect(recs).toHaveLength(1);
      expect(recs[0]).toMatchObject({ parameter: 'ph', severity: 'action', grams: 10 });
    });

    it('doses pH normally when TA was not tested', () => {
      expect(only({ ph: 7.9 })).toMatchObject({ severity: 'action', grams: 10 });
    });

    it('never blocks a pH that is already in range', () => {
      expect(getRecommendations({ ta: 70, ph: 7.4 }).map((r) => r.parameter)).toEqual(['ta']);
    });
  });

  describe('ordering', () => {
    it('emits doses in correction order: TA, then pH, then FC, then CC, then salt', () => {
      const recs = getRecommendations({ ta: 70, ph: 7.9, chlorine: 0.5, cc: 1, salt: 2100 });
      expect(recs.map((r) => r.parameter)).toEqual(['ta', 'ph', 'chlorine', 'cc', 'salt']);
    });

    it('holds pH in place even though it carries no dose', () => {
      const recs = getRecommendations({ ta: 70, ph: 7.9, chlorine: 2 });
      expect(recs.map((r) => r.severity)).toEqual(['action', 'blocked']);
    });

    it('puts criticals before doses', () => {
      const recs = getRecommendations({ ta: 70, chlorine: 6 });
      expect(recs.map((r) => r.parameter)).toEqual(['chlorine', 'ta']);
      expect(recs[0].severity).toBe('critical');
    });

    it('emits doses in correction order when TA is in range', () => {
      const recs = getRecommendations({ ta: 100, ph: 7.9, chlorine: 0.5, cc: 1, salt: 2100 });
      expect(recs.map((r) => r.parameter)).toEqual(['ph', 'chlorine', 'cc', 'salt']);
    });
  });
});

// Doses come from 120 gal charts; a plunge of another size gets each amount
// scaled by gallons / 120, rounded down to 0.5 g.
describe('dose sizing by plunge volume', () => {
  it('uses the chart amounts unchanged at 120 gal (the default)', () => {
    expect(only({ ta: 70 }, { gallons: 120 }).grams).toBe(23);
    expect(only({ ta: 70 }).grams).toBe(23);
  });

  it('halves doses for a 60 gal plunge and doubles them for 240 gal', () => {
    expect(only({ chlorine: 0.5 }, { gallons: 60 }).grams).toBe(3.5);
    expect(only({ chlorine: 0.5 }, { gallons: 240 }).grams).toBe(14);
    expect(only({ ph: 7.9 }, { gallons: 60 }).grams).toBe(5);
    expect(only({ ph: 7.0 }, { gallons: 240 }).grams).toBe(14);
  });

  it('rounds down to the nearest 0.5 g, never below 0.5 g', () => {
    // 23 g × 100 / 120 = 19.17 g
    expect(only({ ta: 70 }, { gallons: 100 }).grams).toBe(19);
    // 10 g × 5 / 120 = 0.42 g
    expect(only({ ph: 7.9 }, { gallons: 5 }).grams).toBe(0.5);
  });

  it('scales the salt dose after counting chart steps', () => {
    // 2100 ppm: 5 steps × 24 g = 120 g at 120 gal
    expect(only({ salt: 2100 }, { gallons: 180 }).grams).toBe(180);
  });

  it('leaves the reasons and non-dose advice alone', () => {
    expect(only({ ta: 70 }, { gallons: 60 }).reason).toBe(only({ ta: 70 }).reason);
    expect(only({ chlorine: 6 }, { gallons: 60 }).grams).toBeNull();
  });
});

describe('scaleGrams and shockDoses', () => {
  it('scales the shock pair', () => {
    expect(shockDoses(120).map((d) => d.grams)).toEqual([10, 30]);
    expect(shockDoses(60).map((d) => d.grams)).toEqual([5, 15]);
  });

  it('is the identity at the chart volume', () => {
    expect(scaleGrams(2.5, 120)).toBe(2.5);
    expect(scaleGrams(920, 300)).toBe(2300);
  });
});

describe('classifyReading', () => {
  it('classifies against house targets and hard limits', () => {
    expect(classifyReading('ta', 100)).toBe('ok');
    expect(classifyReading('ta', 70)).toBe('out-of-target');
    expect(classifyReading('ta', 150)).toBe('out-of-target');
    expect(classifyReading('ph', 7.8)).toBe('ok');
    expect(classifyReading('ph', 8.0)).toBe('out-of-target');
    expect(classifyReading('chlorine', 2)).toBe('ok');
    expect(classifyReading('chlorine', 4)).toBe('out-of-target');
    expect(classifyReading('chlorine', 6)).toBe('critical');
    expect(classifyReading('cc', 0.2)).toBe('ok');
    expect(classifyReading('cc', 1)).toBe('out-of-target');
    expect(classifyReading('salt', 2300)).toBe('ok');
    expect(classifyReading('salt', 2000)).toBe('out-of-target');
    expect(classifyReading('salt', 3200)).toBe('critical');
  });
});

// The log outlines an entry in red when this says the water wasn't guest-safe,
// so its boundaries are pinned as tightly as the dosing charts.
describe('getGuestSafety', () => {
  it('is safe when readings are in range', () => {
    expect(getGuestSafety({ ta: 100, ph: 7.4, chlorine: 2, cc: 0.2, salt: 2300 })).toEqual({
      safe: true,
      reasons: [],
    });
  });

  it('is safe when nothing was tested (no reading, no verdict)', () => {
    expect(getGuestSafety({}).safe).toBe(true);
    expect(getGuestSafety({ ta: null, ph: null, chlorine: null, salt: null }).safe).toBe(true);
  });

  it('is unsafe above the chlorine hard limit', () => {
    const safety = getGuestSafety({ chlorine: 6 });
    expect(safety.safe).toBe(false);
    expect(safety.reasons[0]).toContain('above the 5 ppm safety limit');
  });

  it('is unsafe below the chlorine target floor — unsanitized water', () => {
    const safety = getGuestSafety({ chlorine: 0 });
    expect(safety.safe).toBe(false);
    expect(safety.reasons[0]).toContain('below the 1 ppm minimum');
  });

  it('treats the chlorine target boundaries themselves as safe', () => {
    expect(getGuestSafety({ chlorine: 1 }).safe).toBe(true);
    expect(getGuestSafety({ chlorine: 5 }).safe).toBe(true);
  });

  it('is safe between the chlorine target max and the hard limit', () => {
    expect(getGuestSafety({ chlorine: 4 }).safe).toBe(true);
  });

  it('does not flag out-of-target TA, pH, CC or salt — those are not guest-safety limits', () => {
    expect(getGuestSafety({ ta: 40, ph: 8.4, cc: 2, salt: 3200, chlorine: 2 }).safe).toBe(true);
  });

  it('reports one reason per breached rule', () => {
    expect(getGuestSafety({ chlorine: 6 }).reasons).toHaveLength(1);
  });
});
