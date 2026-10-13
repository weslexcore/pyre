import { describe, expect, it } from 'vitest';
import { parseInline, splitParagraphs } from './inline-markdown';
import { fillContent, fillText, unknownTokens } from './merge-fields';
import { type BlockContent, definitionSchema, type JourneyStep, stepSchema } from './schema';
import { definitionProblems } from './store';
import {
  clampToSendWindow,
  currentStepIndex,
  frequencyCapUntil,
  isStale,
  nextStepIndex,
  sendKeyFor,
  stepDueAt,
} from './timing';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function step(key: string, extra: Partial<JourneyStep> = {}): JourneyStep {
  return stepSchema.parse({
    key,
    timing: { anchor: 'previous', offsetHours: 1 },
    content: { type: 'none' },
    ...extra,
  });
}

describe('stepDueAt', () => {
  const anchors = {
    triggerAt: Date.parse('2026-10-01T20:00:00Z'),
    previousAt: Date.parse('2026-10-03T14:00:00Z'),
    introExpiresAt: Date.parse('2026-10-15T04:00:00Z'),
  };

  it('times trigger-anchored steps from the trigger (session end)', () => {
    expect(stepDueAt({ anchor: 'trigger', offsetHours: 4 }, anchors)).toBe(
      anchors.triggerAt + 4 * HOUR
    );
  });

  it('times previous-anchored steps from the previous step, or the trigger before any', () => {
    expect(stepDueAt({ anchor: 'previous', offsetHours: 24 }, anchors)).toBe(
      anchors.previousAt + DAY
    );
    expect(
      stepDueAt({ anchor: 'previous', offsetHours: 24 }, { ...anchors, previousAt: null })
    ).toBe(anchors.triggerAt + DAY);
  });

  it('supports negative offsets before intro expiry, and null without an intro', () => {
    expect(stepDueAt({ anchor: 'intro-expiry', offsetHours: -48 }, anchors)).toBe(
      anchors.introExpiresAt - 2 * DAY
    );
    expect(
      stepDueAt({ anchor: 'intro-expiry', offsetHours: -48 }, { ...anchors, introExpiresAt: null })
    ).toBeNull();
  });

  it('compresses time after the trigger 60x in fast mode', () => {
    expect(stepDueAt({ anchor: 'trigger', offsetHours: 60 }, anchors, { fastMode: true })).toBe(
      anchors.triggerAt + 60 * 60_000
    );
  });
});

describe('isStale', () => {
  const anchors = { triggerAt: 0, previousAt: null, introExpiresAt: 10 * DAY };

  it('never skips steps timed from the previous email', () => {
    expect(isStale({ anchor: 'previous', offsetHours: 1 }, 0, anchors, 30 * DAY)).toBe(false);
  });

  it('skips an anchored step more than a day late', () => {
    expect(
      isStale({ anchor: 'trigger', offsetHours: 4 }, 4 * HOUR, anchors, 4 * HOUR + 2 * HOUR)
    ).toBe(false);
    expect(
      isStale({ anchor: 'trigger', offsetHours: 4 }, 4 * HOUR, anchors, 4 * HOUR + 25 * HOUR)
    ).toBe(true);
  });

  it('never sends a before-expiry email once the intro has expired', () => {
    const due = 8 * DAY;
    expect(isStale({ anchor: 'intro-expiry', offsetHours: -48 }, due, anchors, 9 * DAY)).toBe(
      false
    );
    expect(
      isStale({ anchor: 'intro-expiry', offsetHours: -48 }, due, anchors, 10 * DAY + HOUR)
    ).toBe(true);
  });
});

describe('step progression by key', () => {
  const steps = [step('a'), step('b', { archived: true }), step('c')];

  it('starts at the first live step and skips archived ones', () => {
    expect(nextStepIndex(steps, null)).toBe(0);
    expect(nextStepIndex(steps, 'a')).toBe(2);
    expect(nextStepIndex(steps, 'c')).toBeNull();
  });

  it('survives reordering: progress follows the key, not the position', () => {
    const reordered = [steps[2], steps[0], steps[1]];
    expect(nextStepIndex(reordered, 'c')).toBe(1);
    expect(currentStepIndex(reordered, 'a')).toBe(1);
  });

  it('moves a member waiting on a now-archived step to the next live one', () => {
    expect(currentStepIndex(steps, 'b')).toBe(2);
    expect(currentStepIndex(steps, 'missing')).toBeNull();
  });
});

describe('clampToSendWindow (America/New_York, 9am-8pm)', () => {
  it('leaves times inside the window alone', () => {
    const t = Date.parse('2026-10-13T15:00:00Z'); // 11am EDT
    expect(clampToSendWindow(t)).toBe(t);
  });

  it('moves early-morning times to 9am the same day', () => {
    expect(new Date(clampToSendWindow(Date.parse('2026-10-13T10:00:00Z'))).toISOString()).toBe(
      '2026-10-13T13:00:00.000Z'
    );
  });

  it('moves evening times to 9am the next day, across DST', () => {
    // 11pm EDT on Nov 1 -> 9am EST on Nov 2 (clocks fall back overnight).
    expect(new Date(clampToSendWindow(Date.parse('2026-11-02T03:00:00Z'))).toISOString()).toBe(
      '2026-11-02T14:00:00.000Z'
    );
  });
});

describe('frequencyCapUntil', () => {
  const now = 100 * DAY;

  it('allows a send with no recent marketing email', () => {
    expect(frequencyCapUntil([], now)).toBeNull();
    expect(frequencyCapUntil([now - 2 * DAY], now)).toBeNull();
  });

  it('holds a second email inside 24 hours until the first ages out', () => {
    expect(frequencyCapUntil([now - 5 * HOUR], now)).toBe(now - 5 * HOUR + DAY);
  });

  it('holds a fourth email inside a week', () => {
    const sends = [now - 2 * DAY, now - 4 * DAY, now - 6 * DAY];
    expect(frequencyCapUntil(sends, now)).toBe(now - 6 * DAY + 7 * DAY);
  });
});

describe('sendKeyFor', () => {
  it('keeps the original key for the first run so converted journeys never resend', () => {
    expect(sendKeyFor('post-intro-offer', 42, 'how-was-it', 0)).toBe(
      'journey:post-intro-offer:42:how-was-it'
    );
    expect(sendKeyFor('win-back', 42, 'offer', 2)).toBe('journey:win-back:42:offer:c2');
  });
});

describe('merge fields', () => {
  it('fills values, uses fallbacks, and reports missing fields', () => {
    const missing = new Set<string>();
    expect(
      fillText(
        'Hi {{firstName}}, {{ creditsLabel | some credits }} left',
        { firstName: 'Ana' },
        missing
      )
    ).toBe('Hi Ana, some credits left');
    expect(missing.size).toBe(0);
    fillText('Expires {{introExpiresOn}}', {}, missing);
    expect([...missing]).toEqual(['introExpiresOn']);
  });

  it('fills every block and flags unknown tokens', () => {
    const content: BlockContent = {
      type: 'blocks',
      subject: 'Hey {{firstName}}',
      preview: '',
      background: 'trees',
      blocks: [
        { type: 'list', items: ['{{creditsLabel}}'] },
        {
          type: 'button',
          label: 'Go',
          url: 'https://pyresauna.com/events',
          color: 'red',
          style: 'filled',
          fullWidth: false,
        },
      ],
    };
    const { content: filled, missing } = fillContent(content, { firstName: 'Ana' });
    expect(filled.subject).toBe('Hey Ana');
    expect(missing).toEqual(['creditsLabel']);
    expect(unknownTokens({ ...content, subject: '{{nickname}}' })).toEqual(['nickname']);
  });
});

describe('inline markdown', () => {
  it('parses bold, italic and safe links only', () => {
    expect(parseInline('a **b** *c* [d](https://x.com) [e](javascript:void)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'd', href: 'https://x.com' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'e' },
    ]);
  });

  it('splits paragraphs on blank lines', () => {
    expect(splitParagraphs('one\n\n two \n\n\n')).toEqual(['one', 'two']);
  });
});

describe('definition validation', () => {
  const base = {
    trigger: { type: 'manual' },
    steps: [
      { key: 'a', timing: { anchor: 'previous', offsetHours: 1 }, content: { type: 'none' } },
    ],
  };

  it('fills defaults', () => {
    const def = definitionSchema.parse(base);
    expect(def.reentry).toEqual({ mode: 'once' });
    expect(def.steps[0].skipIf).toEqual([]);
  });

  it('rejects duplicate step keys, unknown conditions and session conditions without a booking trigger', () => {
    expect(
      definitionSchema.safeParse({ ...base, steps: [base.steps[0], base.steps[0]] }).success
    ).toBe(false);
    expect(definitionSchema.safeParse({ ...base, exitIf: [{ type: 'is-vip' }] }).success).toBe(
      false
    );
    expect(
      definitionSchema.safeParse({ ...base, exitIf: [{ type: 'attended-trigger-session' }] })
        .success
    ).toBe(false);
  });

  it('refuses to drop a step people may be waiting on, and unknown templates', () => {
    const before = definitionSchema.parse(base);
    const after = definitionSchema.parse({
      ...base,
      steps: [
        {
          key: 'b',
          timing: { anchor: 'previous', offsetHours: 1 },
          content: { type: 'template', key: 'nope' },
        },
      ],
    });
    const problems = definitionProblems(after, before);
    expect(problems.some((p) => p.includes('Archive it instead'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown template'))).toBe(true);
  });
});
