import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutosaveConflict,
  AutosaveCore,
  type AutosaveState,
  backupKeys,
  readBackup,
  type SaveFn,
} from './autosave';

class MemoryStorage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

function setup(
  initial: string,
  save: SaveFn<string> | null,
  extra: { initialDirty?: boolean } = {}
) {
  const states: AutosaveState[] = [];
  const core = new AutosaveCore<string>({
    initial,
    initialDirty: extra.initialDirty,
    getSave: () => save,
    backupKey: 'test',
    getMeta: () => ({ id: 'x' }),
    delayMs: 1000,
    onState: (s) => states.push(s),
  });
  return { core, states, last: () => states[states.length - 1] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AutosaveCore', () => {
  it('backs up every change and saves once typing stops, then drops the backup', async () => {
    const save = vi.fn<SaveFn<string>>().mockResolvedValue('saved');
    const { core, last } = setup('', save);

    core.update('h');
    core.update('hi');
    expect(readBackup<string>('test')).toMatchObject({ value: 'hi', meta: { id: 'x' } });
    expect(last().status).toBe('pending');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('hi', { keepalive: false });
    expect(last().status).toBe('saved');
    expect(readBackup('test')).toBeNull();
  });

  it('never overlaps saves: a change during a save is saved right after it', async () => {
    let release: () => void = () => undefined;
    const save = vi
      .fn<SaveFn<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve('saved');
          })
      )
      .mockResolvedValue('saved');
    const { core, last } = setup('', save);

    core.update('a');
    await vi.advanceTimersByTimeAsync(1000);
    core.update('ab');
    const flushed = core.flush();
    expect(save).toHaveBeenCalledTimes(1);
    release();
    expect(await flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('ab', { keepalive: false });
    expect(last().status).toBe('saved');
  });

  it('keeps an unsaveable value on the device and tries again on the next change', async () => {
    const save = vi
      .fn<SaveFn<string>>()
      .mockResolvedValueOnce('skipped')
      .mockResolvedValue('saved');
    const { core, last } = setup('', save);

    core.update('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().status).toBe('local');
    expect(readBackup<string>('test')?.value).toBe('a');

    core.update('ab');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().status).toBe('saved');
  });

  it('stops on a conflict until retried, keeping the backup', async () => {
    const save = vi
      .fn<SaveFn<string>>()
      .mockRejectedValueOnce(new AutosaveConflict())
      .mockResolvedValue('saved');
    const { core, last } = setup('', save);

    core.update('mine');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().status).toBe('conflict');
    core.update('mine2');
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(readBackup<string>('test')?.value).toBe('mine2');

    core.retry();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(last().status).toBe('saved');
  });

  it('reports an error and retries on the next change', async () => {
    const save = vi
      .fn<SaveFn<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('saved');
    const { core, last } = setup('', save);
    core.update('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last()).toMatchObject({ status: 'error', error: 'offline' });
    core.update('ab');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().status).toBe('saved');
  });

  it('a local-only form backs up without saving, until markSaved', () => {
    const { core, last } = setup('a', null);
    core.update('ab');
    expect(last().status).toBe('local');
    expect(readBackup<string>('test')?.value).toBe('ab');
    core.markSaved('ab');
    expect(readBackup('test')).toBeNull();
    expect(last().status).toBe('clean');
  });

  it('a value restored from a backup is saved without waiting for a change', async () => {
    const save = vi.fn<SaveFn<string>>().mockResolvedValue('saved');
    setup('restored', save, { initialDirty: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledWith('restored', { keepalive: false });
  });

  it('hands a pending change over with keepalive when the page goes away', () => {
    const save = vi.fn<SaveFn<string>>().mockResolvedValue('saved');
    const { core } = setup('', save);
    core.update('typed');
    core.leave();
    expect(save).toHaveBeenCalledWith('typed', { keepalive: true });
    // Typing back to what's saved needs nothing.
    const clean = setup('same', save);
    save.mockClear();
    clean.core.leave();
    expect(save).not.toHaveBeenCalled();
  });

  it('lists backups by prefix', () => {
    const { core } = setup('', null);
    core.update('x');
    expect(backupKeys('te')).toEqual(['test']);
    expect(backupKeys('other')).toEqual([]);
  });
});
