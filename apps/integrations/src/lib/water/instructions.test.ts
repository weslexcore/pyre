import { describe, expect, it } from 'vitest';
import { instructionsFor } from './instructions';

const steps = (gallons?: number) =>
  instructionsFor('refill', gallons)?.sections.flatMap((section) => section.steps) ?? [];

describe('instructionsFor', () => {
  it('sizes the fresh-fill salt for the plunge', () => {
    expect(steps().some((step) => step.includes('~920 g Dead Sea Salt'))).toBe(true);
    expect(steps(60).some((step) => step.includes('~460 g Dead Sea Salt'))).toBe(true);
  });

  it('has no procedure for a routine test', () => {
    expect(instructionsFor('test')).toBeNull();
  });
});
