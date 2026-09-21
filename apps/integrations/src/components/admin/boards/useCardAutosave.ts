import { useEffect, useRef, useState } from 'react';

type Patch = Record<string, unknown>;

/** Serialize writes and retain failed edits, including edits made during a request. */
export class CardSaveQueue {
  pending: Patch = {};
  private running: Promise<void> | null = null;

  constructor(private save: (patch: Patch) => Promise<void>) {}

  add(patch: Patch) {
    Object.assign(this.pending, patch);
  }

  get dirty() {
    return this.running !== null || Object.keys(this.pending).length > 0;
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain() {
    while (Object.keys(this.pending).length > 0) {
      const patch = this.pending;
      this.pending = {};
      try {
        await this.save(patch);
      } catch (error) {
        this.pending = { ...patch, ...this.pending };
        throw error;
      }
    }
  }
}

export function useCardAutosave(onSave: (patch: Patch) => Promise<void>) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const [queue] = useState(() => new CardSaveQueue((patch) => saveRef.current(patch)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (!queue.dirty) return true;
    setStatus('saving');
    setError(null);
    try {
      await queue.flush();
      setStatus('saved');
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save changes');
      setStatus('error');
      return false;
    }
  };

  const schedule = (patch: Patch, delay = 600) => {
    queue.add(patch);
    setStatus('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  };

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [queue]);

  return { schedule, flush, status, error };
}
