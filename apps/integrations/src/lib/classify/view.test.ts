import { describe, expect, it } from 'vitest';
import { PENDING_TIMEOUT_MS, toClassificationView } from './view';

const requested = '2026-09-24T12:00:00.000Z';
const at = (ms: number) => new Date(requested).getTime() + ms;

describe('toClassificationView', () => {
  it('passes a fresh pending read through with no signals', () => {
    expect(
      toClassificationView(
        { status: 'pending', signals: [], requested_at: requested, classified_at: null },
        at(1000)
      )
    ).toEqual({ state: 'pending', signals: [], requestedAt: requested, classifiedAt: null });
  });

  it('reads a pending row past the timeout as failed', () => {
    expect(
      toClassificationView(
        { status: 'pending', signals: [], requested_at: requested, classified_at: null },
        at(PENDING_TIMEOUT_MS + 1)
      ).state
    ).toBe('failed');
  });

  it('returns stored signals once done, dropping retired types', () => {
    const view = toClassificationView(
      {
        status: 'done',
        signals: [
          { type: 'action', summary: 'Order towels' },
          { type: 'retired', summary: 'Old kind' },
        ],
        requested_at: requested,
        classified_at: requested,
      },
      at(PENDING_TIMEOUT_MS * 10)
    );
    expect(view.state).toBe('done');
    expect(view.signals).toEqual([{ type: 'action', summary: 'Order towels' }]);
  });

  it('never shows signals on a failed row', () => {
    expect(
      toClassificationView({
        status: 'failed',
        signals: [{ type: 'action', summary: 'Stale' }],
        requested_at: requested,
        classified_at: null,
      }).signals
    ).toEqual([]);
  });
});
