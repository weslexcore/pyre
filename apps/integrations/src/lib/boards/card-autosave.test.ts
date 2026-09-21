import { describe, expect, it, vi } from 'vitest';
import { CardSaveQueue } from '@/components/admin/boards/useCardAutosave';
import { optimisticCardPatch } from '@/components/admin/boards/useOptimisticCardSave';
import type { BoardCardRow, BoardColumnRow } from '@/lib/db';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('card autosave', () => {
  it('coalesces typing and serializes edits made while a save is pending', async () => {
    const request = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => request.promise)
      .mockResolvedValue(undefined);
    const queue = new CardSaveQueue(save);
    queue.add({ title: 'First' });
    queue.add({ title: 'Latest', notesMd: 'Notes' });
    const flush = queue.flush();
    queue.add({ ownerEmail: 'owner@example.com' });
    expect(queue.flush()).toBe(flush);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: 'Latest', notesMd: 'Notes' });
    request.resolve();
    await flush;
    expect(save).toHaveBeenLastCalledWith({ ownerEmail: 'owner@example.com' });
    expect(queue.dirty).toBe(false);
  });

  it('retains failed edits for retry while preferring newer input', async () => {
    const request = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => request.promise)
      .mockResolvedValue(undefined);
    const queue = new CardSaveQueue(save);
    queue.add({ title: 'Earlier', notesMd: 'Keep these notes' });
    const flush = queue.flush();
    queue.add({ title: 'Newer' });
    request.reject(new Error('Offline'));
    await expect(flush).rejects.toThrow('Offline');
    expect(queue.dirty).toBe(true);
    await queue.flush();
    expect(save).toHaveBeenLastCalledWith({ title: 'Newer', notesMd: 'Keep these notes' });
    expect(queue.dirty).toBe(false);
  });

  it('does not write unchanged cards when closing', async () => {
    const save = vi.fn();
    await new CardSaveQueue(save).flush();
    expect(save).not.toHaveBeenCalled();
  });
});

const card = {
  id: 'card',
  title: 'Before',
  column_id: 'open',
  owner_email: 'owner@example.com',
  waiting_on: 'A response',
  completed_at: null,
  completed_by: null,
  properties: { count: 3 },
} as unknown as BoardCardRow;
const columns = [
  { id: 'done', kind: 'done' },
  { id: 'open', kind: 'open' },
] as BoardColumnRow[];

describe('optimistic card updates', () => {
  it('maps edited fields and preserves unrelated card data and the rollback snapshot', () => {
    const next = optimisticCardPatch(
      card,
      { title: 'After', ownerEmail: null, notesMd: 'Notes' },
      columns
    );
    expect(next).toMatchObject({
      title: 'After',
      owner_email: null,
      notes_md: 'Notes',
      properties: { count: 3 },
    });
    expect(card.title).toBe('Before');
    expect(card.owner_email).toBe('owner@example.com');
  });

  it('immediately updates completion and clears waiting when moving to done', () => {
    const done = optimisticCardPatch(card, { columnId: 'done' }, columns);
    expect(done.column_id).toBe('done');
    expect(done.completed_at).not.toBeNull();
    expect(done.waiting_on).toBeNull();
    const reopened = optimisticCardPatch(done, { columnId: 'open' }, columns);
    expect(reopened.completed_at).toBeNull();
  });
});
