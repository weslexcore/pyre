// The optimistic helper: the state changes before the request, stays
// changed when the server agrees (reconciled with its answer), and goes back
// to what it was when the server refuses.
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { isTempId, optimistic, tempId } from './optimistic';

interface Row {
  id: string;
  title: string;
}

/** A stand-in for a React setter: applies updaters at once, keeps the value. */
function stateOf<T>(initial: T) {
  const box = { value: initial };
  const set = (next: T | ((prev: T) => T)) => {
    box.value = typeof next === 'function' ? (next as (p: T) => T)(box.value) : next;
  };
  return { box, set };
}

describe('optimistic', () => {
  it('applies the update before the request and keeps it on success', async () => {
    const { box, set } = stateOf<Row[]>([{ id: 'a', title: 'one' }]);
    let seenDuringRequest: Row[] | null = null;
    const result = await optimistic(
      set,
      (rows) => rows.map((row) => (row.id === 'a' ? { ...row, title: 'two' } : row)),
      async () => {
        seenDuringRequest = box.value;
        return { ok: true };
      }
    );
    expect(seenDuringRequest).toEqual([{ id: 'a', title: 'two' }]);
    expect(box.value).toEqual([{ id: 'a', title: 'two' }]);
    expect(result).toEqual({ ok: true });
  });

  it('folds the server answer in with reconcile', async () => {
    const { box, set } = stateOf<Row[]>([]);
    const pending = tempId();
    await optimistic(
      set,
      (rows) => [...rows, { id: pending, title: 'new' }],
      async () => ({ row: { id: 'real', title: 'new' } }),
      {
        reconcile: (rows, { row }) => rows.map((r) => (r.id === pending ? row : r)),
      }
    );
    expect(box.value).toEqual([{ id: 'real', title: 'new' }]);
  });

  it('rolls back and reports the message when the server refuses', async () => {
    const { box, set } = stateOf<Row[]>([{ id: 'a', title: 'one' }]);
    const onError = vi.fn();
    const result = await optimistic(
      set,
      (rows) => rows.filter((row) => row.id !== 'a'),
      async () => {
        throw new ApiError('Not yours to delete', 403);
      },
      { onError }
    );
    expect(result).toBeNull();
    expect(box.value).toEqual([{ id: 'a', title: 'one' }]);
    expect(onError).toHaveBeenCalledWith('Not yours to delete', expect.any(ApiError));
  });

  it('never throws: a failure without onError is still swallowed', async () => {
    const { box, set } = stateOf(1);
    await expect(
      optimistic(
        set,
        (n) => n + 1,
        async () => {
          throw new Error('boom');
        }
      )
    ).resolves.toBeNull();
    expect(box.value).toBe(1);
  });

  it('issues temporary ids a view can tell from real ones', () => {
    const a = tempId();
    const b = tempId();
    expect(a).not.toBe(b);
    expect(isTempId(a)).toBe(true);
    expect(isTempId('5f1c…')).toBe(false);
  });
});
