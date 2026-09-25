import { describe, expect, it } from 'vitest';
import { shouldAutoSuggest } from './eligibility';
import { isStale, runState } from './runs';
import { hasAutoSuggestSignal, shortDate } from './sources';

describe('shouldAutoSuggest', () => {
  const yes = { enabled: true, eligible: true, alreadyRun: false, dismissed: false };

  it('runs for an eligible record not yet looked at', () => {
    expect(shouldAutoSuggest(yes)).toBe(true);
  });

  it('never runs while switched off', () => {
    expect(shouldAutoSuggest({ ...yes, enabled: false })).toBe(false);
  });

  it('runs once per version of the text', () => {
    expect(shouldAutoSuggest({ ...yes, alreadyRun: true })).toBe(false);
  });

  it('leaves a version alone once its suggestion was dismissed', () => {
    expect(shouldAutoSuggest({ ...yes, dismissed: true })).toBe(false);
  });

  it('needs something to act on', () => {
    expect(shouldAutoSuggest({ ...yes, eligible: false })).toBe(false);
  });
});

describe('hasAutoSuggestSignal', () => {
  it('fires on actions and updates', () => {
    expect(hasAutoSuggestSignal([{ type: 'action', probability: 0.9 }])).toBe(true);
    expect(hasAutoSuggestSignal([{ type: 'update', probability: 0.7 }])).toBe(true);
  });

  it('leaves questions, feedback, and nothing alone', () => {
    expect(hasAutoSuggestSignal([{ type: 'question', probability: 0.9 }])).toBe(false);
    expect(hasAutoSuggestSignal([{ type: 'feedback', probability: 0.9 }])).toBe(false);
    expect(hasAutoSuggestSignal([])).toBe(false);
    expect(hasAutoSuggestSignal(null)).toBe(false);
  });
});

describe('run staleness', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');

  it('reads a long-open run as failed', () => {
    const run = { status: 'running' as const, created_at: '2026-09-25T11:30:00Z' };
    expect(isStale(run, now)).toBe(true);
    expect(runState(run, now)).toBe('failed');
  });

  it('leaves a fresh or finished run alone', () => {
    expect(runState({ status: 'running', created_at: '2026-09-25T11:55:00Z' }, now)).toBe(
      'running'
    );
    expect(runState({ status: 'done', created_at: '2026-09-24T11:00:00Z' }, now)).toBe('done');
  });
});

describe('shortDate', () => {
  it('reads a note date the way people say it', () => {
    expect(shortDate('2026-09-24')).toBe('Sep 24');
  });
});
