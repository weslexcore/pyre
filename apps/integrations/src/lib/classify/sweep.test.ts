// The sweep is the backstop for background runs that never finished; it
// must pick those up without re-running settled notes or retrying forever.
import { describe, expect, it } from 'vitest';
import { contentHash, MAX_ATTEMPTS } from './request';
import { needsClassification } from './sweep';

const now = Date.parse('2026-09-24T12:00:00Z');
const row = (over: Record<string, unknown> = {}) =>
  ({
    subject_id: 'n1',
    status: 'done',
    content_hash: contentHash('Towels low'),
    attempts: 1,
    requested_at: new Date(now - 60_000).toISOString(),
    signals: [],
    classified_at: new Date(now - 59_000).toISOString(),
    ...over,
  }) as never;

describe('needsClassification', () => {
  it('runs notes that were never classified, or whose text changed since', () => {
    expect(needsClassification(undefined, 'Towels low', now)).toBe(true);
    expect(needsClassification(row(), 'Towels are fine now', now)).toBe(true);
  });

  it('leaves settled and in-flight notes alone', () => {
    expect(needsClassification(row(), 'Towels low', now)).toBe(false);
    expect(needsClassification(row({ status: 'pending' }), 'Towels low', now)).toBe(false);
  });

  it('retries failed and stalled runs until the attempt cap', () => {
    expect(needsClassification(row({ status: 'failed' }), 'Towels low', now)).toBe(true);
    const stalled = row({
      status: 'pending',
      requested_at: new Date(now - 60 * 60_000).toISOString(),
    });
    expect(needsClassification(stalled, 'Towels low', now)).toBe(true);
    expect(
      needsClassification(row({ status: 'failed', attempts: MAX_ATTEMPTS }), 'Towels low', now)
    ).toBe(false);
  });
});
