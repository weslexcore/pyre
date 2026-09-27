import { compactInputClass } from '@/components/admin/ui';
// Shared class strings and small helpers for the inbox and messages islands
// (the ShiftNotes constants, lifted so the bell, the inbox, the message
// list, and the thread all draw the same controls).

export const dangerButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-red)] hover:border-[var(--pyre-red)] transition-colors disabled:opacity-40';

export const textareaClass = `${compactInputClass} min-h-[160px] w-full font-mono text-xs leading-relaxed`;

export const replyTextareaClass = `${compactInputClass} min-h-[80px] w-full`;

export const chipClass =
  'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide';

export { buttonClass } from '@/components/admin/ui';
