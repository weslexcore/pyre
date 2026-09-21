// Shared class strings and small helpers for the inbox and messages islands
// (the ShiftNotes constants, lifted so the bell, the inbox, the message
// list, and the thread all draw the same controls).

export const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export const primaryButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

export const dangerButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-red)] hover:border-[var(--pyre-red)] transition-colors disabled:opacity-40';

export const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

export const textareaClass = `${inputClass} min-h-[160px] w-full font-mono text-xs leading-relaxed`;

export const replyTextareaClass = `${inputClass} min-h-[80px] w-full`;

export const chipClass =
  'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide';

export async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 'Sep 14, 6:04 PM' in the bathhouse's wall-clock time. */
export function formatStamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}
