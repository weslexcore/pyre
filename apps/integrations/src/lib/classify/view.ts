// What a page sees of a classification: its state and the signals found,
// never the request id or other bookkeeping. Client-bundle-safe (no db/env
// imports) so islands can import the type and the helpers alike.

import { readStoredSignals, type Signal } from '@pyre/signals-core';
import type { ContentClassificationRow } from '@/lib/db';

export type ClassificationState = 'pending' | 'done' | 'failed';

export interface ClassificationView {
  state: ClassificationState;
  /** What was found; empty while pending, on failure, or when nothing was. */
  signals: Signal[];
  requestedAt: string;
  classifiedAt: string | null;
}

/**
 * A run that has not saved within this long is not going to: Jev reads a
 * note in well under a second, so anything this old failed without telling
 * us (a crashed turn, a lost request). It reads as failed and can be re-run.
 */
export const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

export function toClassificationView(
  row: Pick<ContentClassificationRow, 'status' | 'signals' | 'requested_at' | 'classified_at'>,
  now: number = Date.now()
): ClassificationView {
  const expired =
    row.status === 'pending' && now - new Date(row.requested_at).getTime() > PENDING_TIMEOUT_MS;
  const state: ClassificationState = expired ? 'failed' : row.status;
  return {
    state,
    signals: state === 'done' ? readStoredSignals(row.signals) : [],
    requestedAt: row.requested_at,
    classifiedAt: row.classified_at,
  };
}
