// The glossary is what staff read to decide what a reading means, so the two
// ways it can go wrong are pinned here: a missing measurement, and a target
// that has drifted out of step with the charts it claims to quote.

import { describe, expect, it } from 'vitest';
import { HARD_LIMITS, type Parameter, TARGETS } from './charts';
import { GLOSSARY } from './glossary';

const PARAMETERS = Object.keys(TARGETS) as Parameter[];

describe('GLOSSARY', () => {
  it('covers every measured parameter', () => {
    expect(Object.keys(GLOSSARY).sort()).toEqual([...PARAMETERS].sort());
  });

  it.each(PARAMETERS)('%s has all four explanation sections filled in', (parameter) => {
    const entry = GLOSSARY[parameter];
    for (const section of ['what', 'why', 'chemistry', 'correcting'] as const) {
      expect(entry[section].length).toBeGreaterThan(40);
    }
    expect(entry.name).toBeTruthy();
    expect(entry.chip).toBeTruthy();
  });

  it('quotes the house target ranges from charts.ts', () => {
    expect(GLOSSARY.ta.target).toBe(`${TARGETS.ta[0]}–${TARGETS.ta[1]} ppm`);
    expect(GLOSSARY.ph.target).toBe(`${TARGETS.ph[0]}–${TARGETS.ph[1]}`);
    expect(GLOSSARY.chlorine.target).toBe(`${TARGETS.chlorine[0]}–${TARGETS.chlorine[1]} ppm`);
    expect(GLOSSARY.salt.target).toBe(`${TARGETS.salt[0]}–${TARGETS.salt[1]} ppm`);
    expect(GLOSSARY.cc.target).toContain(String(TARGETS.cc[1]));
  });

  it('states a hard limit for exactly the two parameters that have one', () => {
    const withLimit = PARAMETERS.filter((p) => GLOSSARY[p].limit);
    expect(withLimit.sort()).toEqual(Object.keys(HARD_LIMITS).sort());
    expect(GLOSSARY.chlorine.limit).toContain(String(HARD_LIMITS.chlorine));
    expect(GLOSSARY.salt.limit).toContain(String(HARD_LIMITS.salt));
  });

  it('tells the reader TA comes before pH on both entries', () => {
    expect(GLOSSARY.ta.chemistry).toContain('pH');
    expect(GLOSSARY.ph.chemistry).toContain('TA');
  });
});
