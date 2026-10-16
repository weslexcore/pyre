// Autosave for forms that are written over minutes, not seconds — admin
// messages, their drafts, message templates. Two layers:
//
//   * A local backup. Every change is mirrored into localStorage under the
//     form's key, so a closed tab, a dead connection, or a mis-tap on Back
//     never costs what was typed. It is cleared once the server has the same
//     thing (or the form is sent/discarded). Forms that must not change on
//     the server as they're typed (an edit to a message staff can already
//     read) use this layer alone.
//   * A server save. A second after typing stops, the value is handed to the
//     form's save function. Saves never overlap: a change made while one is
//     in flight is saved right after it. A save may report 'skipped' when
//     the value isn't saveable yet (a template with no name) — the backup
//     keeps it until it is. Throwing AutosaveConflict means someone else
//     saved first: autosave stops until the form resolves it (retry()), and
//     the backup holds this person's version meanwhile.
//
// When the page is hidden (tab closed, navigated away) a pending change is
// handed to save once more with `keepalive`, so the request outlives the page;
// the save function decides what is safe to send that way.
//
// AutosaveCore is framework-free so it can be tested with fake timers;
// useAutosave binds it to a component.

import { useEffect, useRef, useState } from 'react';

export type SaveOutcome = 'saved' | 'skipped';
export type SaveFn<T> = (value: T, options: { keepalive: boolean }) => Promise<SaveOutcome>;

/** Thrown by a save function when the server refused it as stale (409). */
export class AutosaveConflict extends Error {
  constructor(message = 'Someone else saved this since you opened it.') {
    super(message);
    this.name = 'AutosaveConflict';
  }
}

export type AutosaveStatus =
  /** Nothing typed since it was loaded or last saved, and no save this session. */
  | 'clean'
  /** Changed; a save is scheduled. */
  | 'pending'
  | 'saving'
  /** The server has exactly what's on screen. */
  | 'saved'
  /** Kept on this device only — local-only forms, or not saveable yet. */
  | 'local'
  /** The last save failed; the next change tries again. */
  | 'error'
  /** Someone else saved first; stopped until the form calls retry(). */
  | 'conflict';

export interface AutosaveState {
  status: AutosaveStatus;
  savedAt: string | null;
  error: string | null;
}

export interface Backup<T> {
  value: T;
  /** Whatever the form needs to pick up where it left off (an id, a version). */
  meta: unknown;
  at: string;
}

const BACKUP_PREFIX = 'pyre:autosave:';

/** The local backup under `key`, or null (none, unreadable, or storage blocked). */
export function readBackup<T>(key: string): Backup<T> | null {
  try {
    const raw = window.localStorage.getItem(BACKUP_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Backup<T>;
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBackup(key: string, value: unknown, meta: unknown): void {
  try {
    const backup: Backup<unknown> = { value, meta, at: new Date().toISOString() };
    window.localStorage.setItem(BACKUP_PREFIX + key, JSON.stringify(backup));
  } catch {
    // Private mode or a full quota: the backup is a safety net, not a requirement.
  }
}

export function clearBackup(key: string): void {
  try {
    window.localStorage.removeItem(BACKUP_PREFIX + key);
  } catch {
    // As above.
  }
}

/** Every backup key starting with `prefix` (without the storage namespace). */
export function backupKeys(prefix: string): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(BACKUP_PREFIX + prefix)) keys.push(key.slice(BACKUP_PREFIX.length));
    }
    return keys;
  } catch {
    return [];
  }
}

export interface AutosaveCoreOptions<T> {
  initial: T;
  /** True when `initial` isn't what the server holds (restored from a backup). */
  initialDirty?: boolean;
  /** The current save function, or null for a local-only form. */
  getSave: () => SaveFn<T> | null;
  backupKey: string | null;
  getMeta?: () => unknown;
  delayMs?: number;
  onState: (state: AutosaveState) => void;
}

export class AutosaveCore<T> {
  private value: T;
  private savedJson: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private rerun = false;
  private blocked = false;
  private state: AutosaveState = { status: 'clean', savedAt: null, error: null };

  constructor(private readonly options: AutosaveCoreOptions<T>) {
    this.value = options.initial;
    this.savedJson = options.initialDirty ? null : JSON.stringify(options.initial);
    if (options.initialDirty) this.schedule();
  }

  get dirty(): boolean {
    return JSON.stringify(this.value) !== this.savedJson;
  }

  get current(): AutosaveState {
    return this.state;
  }

  private set(next: Partial<AutosaveState>) {
    this.state = { ...this.state, ...next };
    this.options.onState(this.state);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private backup() {
    const { backupKey, getMeta } = this.options;
    if (backupKey) writeBackup(backupKey, this.value, getMeta?.() ?? null);
  }

  private dropBackup() {
    if (this.options.backupKey) clearBackup(this.options.backupKey);
  }

  private schedule() {
    this.backup();
    if (this.blocked) return;
    if (!this.options.getSave()) {
      this.set({ status: 'local', error: null });
      return;
    }
    this.set({ status: 'pending' });
    this.clearTimer();
    this.timer = setTimeout(() => void this.run(), this.options.delayMs ?? 1200);
  }

  /** The form changed. */
  update(value: T): void {
    this.value = value;
    if (!this.dirty) {
      this.clearTimer();
      this.dropBackup();
      if (!this.blocked) {
        this.set({ status: this.state.savedAt ? 'saved' : 'clean', error: null });
      }
      return;
    }
    this.schedule();
  }

  private run(): Promise<void> {
    this.clearTimer();
    const save = this.options.getSave();
    if (!save || this.blocked) return Promise.resolve();
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    if (!this.dirty) return Promise.resolve();

    const value = this.value;
    const json = JSON.stringify(value);
    this.set({ status: 'saving', error: null });
    this.inFlight = (async () => {
      try {
        const outcome = await save(value, { keepalive: false });
        if (outcome === 'skipped') {
          this.set({ status: 'local' });
          return;
        }
        this.savedJson = json;
        this.set({ savedAt: new Date().toISOString() });
        if (this.dirty) {
          this.schedule();
        } else {
          this.dropBackup();
          this.set({ status: 'saved' });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to save';
        if (e instanceof AutosaveConflict) {
          this.blocked = true;
          this.set({ status: 'conflict', error: message });
        } else {
          this.set({ status: 'error', error: message });
        }
      } finally {
        this.inFlight = null;
        if (this.rerun) {
          this.rerun = false;
          if (this.dirty && !this.blocked) void this.run();
        }
      }
    })();
    return this.inFlight;
  }

  /**
   * Save anything pending now and wait for it. True when the server has
   * what's on screen; false when it couldn't (error, conflict, not saveable,
   * local-only).
   */
  async flush(): Promise<boolean> {
    this.clearTimer();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (this.inFlight) {
        await this.inFlight;
        continue;
      }
      if (!this.dirty || this.blocked || !this.options.getSave()) break;
      await this.run();
      if (this.state.status !== 'saved' && this.state.status !== 'pending') break;
    }
    return !this.dirty;
  }

  /** After a conflict is resolved (the form changed what save sends): save again. */
  retry(): void {
    this.blocked = false;
    this.set({ status: 'pending', error: null });
    void this.run();
  }

  /**
   * The server now holds `value` some other way (an explicit save, a send,
   * a reload of the other person's version): make it the baseline.
   */
  markSaved(value: T): void {
    this.clearTimer();
    this.blocked = false;
    this.value = value;
    this.savedJson = JSON.stringify(value);
    this.dropBackup();
    this.set({ status: 'clean', error: null });
  }

  /** The page is going away: hand a pending change over once more, unawaited. */
  leave(): void {
    this.clearTimer();
    const save = this.options.getSave();
    if (!save || !this.dirty || this.inFlight || this.blocked) return;
    this.backup();
    void save(this.value, { keepalive: true }).catch(() => undefined);
  }
}

export interface UseAutosaveOptions<T> {
  value: T;
  /** Null for a local-only form (backup, no server save). */
  save: SaveFn<T> | null;
  backupKey: string | null;
  meta?: unknown;
  /** True when `value` started from a local backup, not from the server. */
  initialDirty?: boolean;
  delayMs?: number;
}

export interface UseAutosave<T> extends AutosaveState {
  flush: () => Promise<boolean>;
  retry: () => void;
  markSaved: (value: T) => void;
}

export function useAutosave<T>(options: UseAutosaveOptions<T>): UseAutosave<T> {
  const saveRef = useRef(options.save);
  saveRef.current = options.save;
  const metaRef = useRef(options.meta);
  metaRef.current = options.meta;
  const [state, setState] = useState<AutosaveState>({
    status: options.initialDirty ? (options.save ? 'pending' : 'local') : 'clean',
    savedAt: null,
    error: null,
  });
  const [core] = useState(
    () =>
      new AutosaveCore<T>({
        initial: options.value,
        initialDirty: options.initialDirty,
        getSave: () => saveRef.current,
        backupKey: options.backupKey,
        getMeta: () => metaRef.current,
        delayMs: options.delayMs,
        onState: setState,
      })
  );

  const json = JSON.stringify(options.value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized value
  useEffect(() => {
    core.update(options.value);
  }, [core, json]);

  useEffect(() => {
    const onHide = () => core.leave();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      core.leave();
    };
  }, [core]);

  return {
    ...state,
    flush: () => core.flush(),
    retry: () => core.retry(),
    markSaved: (value: T) => core.markSaved(value),
  };
}

/**
 * A JSON request for an autosaving form: the parsed body on success, an
 * AutosaveConflict for a 409 the server marks `conflict: true` (someone else
 * saved first), an Error with the server's message otherwise.
 */
export async function sendJson<T>(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  options: { keepalive?: boolean } = {}
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: options.keepalive,
  });
  if (res.ok) return (await res.json()) as T;
  let data: { error?: string; conflict?: boolean } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Not JSON — fall back to the status below.
  }
  const message = data.error ?? `HTTP ${res.status}`;
  if (res.status === 409 && data.conflict) throw new AutosaveConflict(message);
  throw new Error(message);
}
