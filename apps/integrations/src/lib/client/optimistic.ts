// Optimistic mutations for the /admin islands: the view changes the moment
// the person acts, the request goes out behind it, and only a refusal from
// the server is ever waited for.
//
// `set` is any React state setter (useState's, or the setData that
// lib/client/cachedJson hands back, which writes through to the cache so the
// change survives navigating away and back). `update` is applied to the
// current state before the request is sent; if the request fails, the state
// is put back to the snapshot taken just before it, and `onError` gets the
// message to show. `reconcile` folds the server's answer in once it lands —
// the real id of a row created under a temporary one, say.
//
// Nothing here blocks: callers should stop disabling their whole UI on a
// `busy` flag for saves that go through this, and mark only the row whose
// request is still out, when they mark anything at all.

import { ApiError } from './api';

export type Setter<T> = (next: T | ((prev: T) => T)) => void;

export interface OptimisticOptions<T, R> {
  /** Fold the server's response into the state once it arrives. */
  reconcile?: (current: T, result: R) => T;
  /** After the rollback: the message to show, and the error behind it. */
  onError?: (message: string, error: unknown) => void;
}

/** The message a failed call should show. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Apply `update` now, send `commit`, roll back if it fails. Resolves with
 * the commit's result, or null after a failure (which has already been
 * reported through `onError`, so callers need not catch anything).
 */
export async function optimistic<T, R = unknown>(
  set: Setter<T>,
  update: (prev: T) => T,
  commit: () => Promise<R>,
  options: OptimisticOptions<T, R> = {}
): Promise<R | null> {
  let snapshot: T | undefined;
  let taken = false;
  set((prev) => {
    snapshot = prev;
    taken = true;
    return update(prev);
  });
  try {
    const result = await commit();
    if (options.reconcile) {
      const reconcile = options.reconcile;
      set((current) => reconcile(current, result));
    }
    return result;
  } catch (error) {
    // React batches the setter, so the snapshot is only in hand once the
    // updater has run; without one there is nothing to restore.
    if (taken) set(() => snapshot as T);
    options.onError?.(errorMessage(error), error);
    return null;
  }
}

let tempCounter = 0;

/**
 * An id for a row the server has not named yet. Distinct from anything the
 * database issues, so a view can tell its pending rows apart (and reconcile
 * them away once the real row comes back).
 */
export function tempId(): string {
  tempCounter += 1;
  return `pending-${Date.now().toString(36)}-${tempCounter}`;
}

/** Whether `id` came from tempId(): the row is still waiting on the server. */
export function isTempId(id: string): boolean {
  return id.startsWith('pending-');
}
