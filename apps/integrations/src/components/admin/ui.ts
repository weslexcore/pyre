// The admin islands' shared control styles. Each string here was copied into
// several islands before it lived here; a new island should reach for these
// rather than write its own. Domain modules (goalsUi, incidentUi, messagesUi,
// scheduleUi) keep only what is theirs and re-export the rest.

/** The everyday button: toolbars, row actions, dialogs. */
export const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

/** The same button a notch taller, to sit beside a form's py-2.5 fields. */
export const formButtonClass =
  'px-3 py-2 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

/** The gold outline for the one action a panel exists for (Save, Post). */
export const goldButtonClass =
  'px-3 py-1.5 rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 text-xs font-mono uppercase tracking-wide text-[var(--pyre-gold)] hover:border-[var(--pyre-gold)] transition-colors disabled:opacity-40';

/** Text input in a settings table or manager form. */
export const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

/** Text input in a toolbar or inline row. */
export const compactInputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

/** The xs input the business and insights tables use for figures. */
export const tinyInputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

/** Select sized to sit beside inputClass. */
export const selectClass =
  'px-2 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

/** Select sized to sit beside compactInputClass. */
export const compactSelectClass =
  'px-2 py-1.5 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30 [&>option]:bg-[var(--pyre-black)]';

/** The label above a form field. */
export const labelClass = 'block mb-1.5 font-mono text-xs uppercase tracking-wide text-white/50';

/** The smaller label above a compact field. */
export const microLabelClass = 'block font-mono text-[10px] uppercase tracking-wide text-white/50';

export const cardClass = 'rounded border border-white/10 bg-white/[0.03] p-4';

/** The grip on a drag-to-reorder row. */
export const dragHandleClass =
  'cursor-grab touch-none rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50 transition-colors hover:border-white/30 hover:text-white active:cursor-grabbing disabled:opacity-30';
