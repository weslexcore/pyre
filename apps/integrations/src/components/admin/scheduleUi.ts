// Shared toolbar styling for the schedule surfaces. Two vocabularies on
// purpose: square pills change WHAT you're looking at (views, nav, actions);
// round gold chips narrow the CURRENT view (filters).

/** Filter chips — rounded-full + gold so filters read differently from the
 *  square view pills even when inactive or wrapped onto another line. */
export const filterChipClass = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-[var(--pyre-gold)]/50 hover:text-white'
  }`;

/** Muted caption prefixing a control group ("Filter", "Viewing", "Range"…). */
export const toolbarCaptionClass = 'font-mono text-xs uppercase tracking-wide text-white/40';
