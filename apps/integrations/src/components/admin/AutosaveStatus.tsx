// The one-line autosave readout under a long form (lib/client/autosave):
// saving, saved at, kept on this device, or why it couldn't save. A conflict
// — someone else saved first — gets the two ways out as buttons.

import type { AutosaveState } from '@/lib/client/autosave';
import { etTime } from '@/lib/client/format';

export function AutosaveStatus({
  state,
  savedLabel = 'Saved',
  cleanHint,
  localHint = 'Changes kept on this device',
  onKeepMine,
  onUseTheirs,
}: {
  state: AutosaveState;
  /** "Saved" / "Saved to Drafts" — followed by the time. */
  savedLabel?: string;
  /** Shown before anything has been typed. */
  cleanHint?: string;
  /** Shown while changes live only in this browser. */
  localHint?: string;
  onKeepMine?: () => void;
  onUseTheirs?: () => void;
}) {
  const text = (() => {
    switch (state.status) {
      case 'clean':
        return cleanHint ?? '';
      case 'pending':
      case 'saving':
        return 'Saving…';
      case 'saved':
        return state.savedAt ? `${savedLabel} ${etTime(state.savedAt)}` : savedLabel;
      case 'local':
        return localHint;
      case 'error':
        return `Couldn't save (${state.error ?? 'unknown error'}). Kept on this device; trying again as you type.`;
      case 'conflict':
        return `${state.error ?? 'Someone else saved this first.'} Your version is kept on this device.`;
    }
  })();
  if (!text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] ${
        state.status === 'error' || state.status === 'conflict'
          ? 'text-[var(--pyre-gold)]'
          : 'text-white/40'
      }`}
    >
      <span>{text}</span>
      {state.status === 'conflict' && onKeepMine && (
        <button type="button" className="uppercase tracking-wide underline" onClick={onKeepMine}>
          Keep mine
        </button>
      )}
      {state.status === 'conflict' && onUseTheirs && (
        <button type="button" className="uppercase tracking-wide underline" onClick={onUseTheirs}>
          Use theirs
        </button>
      )}
    </div>
  );
}
