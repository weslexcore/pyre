import { describe, expect, it } from 'vitest';
import { contentHash } from '@/lib/classify/hash';
import { shouldAutoSuggest } from './eligibility';
import { isStale, runState } from './runs';
import {
  formatMonthDay,
  hasAutoSuggestSignal,
  noteThreadHash,
  type SourceRecord,
  SUGGESTION_SOURCES,
} from './sources';

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
  const DEFAULT = ['action', 'update'];

  it('fires on actions and updates', () => {
    expect(hasAutoSuggestSignal([{ type: 'action', probability: 0.9 }], DEFAULT)).toBe(true);
    expect(hasAutoSuggestSignal([{ type: 'update', probability: 0.7 }], DEFAULT)).toBe(true);
  });

  it('leaves questions, feedback, and nothing alone', () => {
    expect(hasAutoSuggestSignal([{ type: 'question', probability: 0.9 }], DEFAULT)).toBe(false);
    expect(hasAutoSuggestSignal([{ type: 'feedback', probability: 0.9 }], DEFAULT)).toBe(false);
    expect(hasAutoSuggestSignal([], DEFAULT)).toBe(false);
    expect(hasAutoSuggestSignal(null, DEFAULT)).toBe(false);
  });

  it('follows the signals chosen in Settings', () => {
    expect(hasAutoSuggestSignal([{ type: 'question', probability: 0.9 }], ['question'])).toBe(true);
    expect(hasAutoSuggestSignal([{ type: 'action', probability: 0.9 }], ['safety'])).toBe(false);
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

describe('formatMonthDay', () => {
  it('reads a note date the way people say it', () => {
    expect(formatMonthDay('2026-09-24')).toBe('Sep 24');
  });
});

describe('noteThreadHash', () => {
  const body = 'Out of eucalyptus. Should I order more?';
  const reply = { id: '4f2a9c1e-7b3d-4e5f-a6b7-c8d9e0f1a2b3', body: 'Yes, order a case.' };

  it('hashes a note nobody replied to as its body, as before replies counted', () => {
    expect(noteThreadHash(body, [])).toBe(contentHash(body));
  });

  it('is a new version when someone replies, and again when a reply changes', () => {
    const replied = noteThreadHash(body, [reply]);
    expect(replied).not.toBe(contentHash(body));
    expect(noteThreadHash(body, [{ ...reply, body: 'No, we have plenty.' }])).not.toBe(replied);
    expect(noteThreadHash(body, [reply])).toBe(replied);
  });

  it('does not mistake a reply for more of the body', () => {
    expect(noteThreadHash(body, [reply])).not.toBe(contentHash(`${body}\n${reply.body}`));
  });
});

describe('replyEligible', () => {
  const record = (closed: boolean) => ({ closed }) as SourceRecord;

  it('looks at an open shift note again after a reply, whatever the classifier found', () => {
    expect(SUGGESTION_SOURCES.shift_note.replyEligible(record(false))).toBe(true);
    expect(SUGGESTION_SOURCES.shift_note.replyEligible(record(true))).toBe(false);
  });

  it('never starts a run on a Pyre Agent chat', () => {
    expect(SUGGESTION_SOURCES.pyre_agent.replyEligible(record(false))).toBe(false);
  });
});
