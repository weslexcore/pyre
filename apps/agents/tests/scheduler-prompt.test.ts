// The scheduler's system prompt is assembled at session start from the base
// instructions plus whatever standing instructions the admin has saved. What
// matters here is that an empty setting leaves the prompt untouched, and a
// non-empty one lands inside its own fence with its precedence spelled out.

import { describe, expect, it } from 'vitest';
import {
  SCHEDULER_INSTRUCTIONS,
  schedulerInstructionsWith,
} from '../agent/lib/prompts/scheduler';

describe('schedulerInstructionsWith', () => {
  it('returns the prompt unchanged when no standing instructions are set', () => {
    expect(schedulerInstructionsWith('')).toBe(SCHEDULER_INSTRUCTIONS);
  });

  it('fences the standing instructions and keeps the base prompt intact', () => {
    const prompt = schedulerInstructionsWith('Wes never works Sundays.');
    expect(prompt.startsWith(SCHEDULER_INSTRUCTIONS)).toBe(true);
    expect(prompt).toContain(
      '<standing-instructions>\nWes never works Sundays.\n</standing-instructions>'
    );
  });

  it('states the precedence the drafter has to apply', () => {
    const prompt = schedulerInstructionsWith('Saturday evenings need two people.');
    // Hard rules still win, a per-run note still wins over these, and they
    // beat the judgment guidelines.
    expect(prompt).toContain('They never outrank the hard rules');
    expect(prompt).toContain('A per-run `<admin-note>` outranks them');
    expect(prompt).toContain('They outrank everything in "Judgment guidelines"');
  });

  it('points the judgment guidelines at the block', () => {
    expect(SCHEDULER_INSTRUCTIONS).toContain('`<standing-instructions>` block');
  });
});
