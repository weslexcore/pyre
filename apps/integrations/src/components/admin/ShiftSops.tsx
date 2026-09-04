// The "Shift SOPs" block: the documents defining the duties someone holds on
// their current-or-next shift. Rendered statically on the admin home (under
// the shift chip) and inside the SOP library island, from the same payload
// (lib/sops/shift-sops.ts) so the two never drift.
import type { ShiftSops } from '@/lib/sops/shift-sops';

/** "Set Up (A) — Fire + Water": the letter alone doesn't say which half. */
function dutyTitle(label: string, detail: string | null): string {
  return detail ? `${label} — ${detail}` : label;
}

/**
 * The heading's subject: what the block is about right now. A live shift
 * reads as one, an unstarted one names when it is.
 */
export function shiftSopsWhen(shift: ShiftSops): string {
  if (shift.isInSession) return 'In session';
  return shift.isToday ? `Today · ${shift.shiftLabel}` : `Next shift · ${shift.shiftLabel}`;
}

export function ShiftSopsPanel({ shift }: { shift: ShiftSops }) {
  // Sage is the schedule's duty colour throughout (the board's duty chips,
  // the picker's pills), so the block reads as "your shift" rather than as
  // another gold SOP strip.
  return (
    <section>
      <h2 className="mb-3 flex flex-wrap items-baseline gap-x-2 font-mono text-xs uppercase tracking-wide text-[var(--pyre-sage)]">
        Shift SOPs
        <span className="text-white/40">{shiftSopsWhen(shift)}</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shift.sops.map((sop) => (
          <a
            key={sop.duty}
            href={`/admin/sops/${sop.slug}`}
            className="block rounded border border-[var(--pyre-sage)]/40 bg-[var(--pyre-sage)]/5 p-4 transition-colors hover:border-[var(--pyre-sage)]"
            title={dutyTitle(sop.label, sop.detail)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-sage)]">
                {sop.label}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                open →
              </span>
            </div>
            <h3 className="mt-1 font-semibold text-[var(--pyre-creme)]">{sop.title}</h3>
            <p className="mt-1 font-mono text-[10px] text-white/40">
              {[sop.detail, sop.taskCount > 0 ? `${sop.taskCount} steps` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
