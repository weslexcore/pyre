// The ⓘ next to every reading on /admin/water, and the modal it opens.
// Staff rotate through this tool, and a number with no explanation gets
// entered without being understood — so each measurement carries its own
// "what is this, why does it matter, how does it move the rest" panel,
// sourced from lib/water/glossary.
import { useRef } from 'react';
import { Modal } from '@/components/admin/Modal';
import type { Parameter } from '@/lib/water/charts';
import { GLOSSARY } from '@/lib/water/glossary';

const SECTIONS = [
  ['What it measures', 'what'],
  ['Why it matters', 'why'],
  ['How it moves the rest of the water', 'chemistry'],
  ['When it reads out of range', 'correcting'],
] as const;

/**
 * Modal body for one measurement. Rendered only while open, so the escape
 * handler and the scroll lock live and die with it.
 */
function MeasurementDialog({ parameter, onClose }: { parameter: Parameter; onClose: () => void }) {
  const entry = GLOSSARY[parameter];
  const closeRef = useRef<HTMLButtonElement>(null);

  // whitespace-normal: the dialog mounts inline under the ⓘ, which sits inside
  // the log's whitespace-nowrap reading chips — white-space inherits straight
  // through fixed positioning, so without the reset every paragraph in here
  // renders as one unwrapped line off the page.
  return (
    <Modal
      labelledBy={`measurement-info-${parameter}`}
      onClose={onClose}
      backdropLabel="Close"
      initialFocus={closeRef}
      panelClassName="max-w-lg whitespace-normal rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-5 shadow-xl sm:rounded-lg"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id={`measurement-info-${parameter}`}
            className="font-primary-semibold text-xl text-[var(--pyre-creme)]"
          >
            {entry.name}
          </h2>
          <div className="mt-1 font-mono text-xs text-white/50">
            Target {entry.target}
            {entry.limit && (
              <>
                {' · '}
                <span className="text-[var(--pyre-red)]">Hard limit {entry.limit}</span>
              </>
            )}
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded border border-white/20 px-3 py-1.5 font-mono-bold text-xs uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="space-y-3">
        {SECTIONS.map(([heading, key]) => (
          <div key={key}>
            <div className="mb-1 font-mono-bold text-xs uppercase tracking-wide text-white/40">
              {heading}
            </div>
            <p className="text-sm leading-relaxed text-white/70">{entry[key]}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * The ⓘ affordance itself. `open`/`onOpenChange` are lifted so only one modal
 * can be open across the page — the log renders one of these per reading on
 * every entry.
 */
export function MeasurementInfoButton({
  parameter,
  open,
  onOpenChange,
  className = '',
}: {
  parameter: Parameter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const entry = GLOSSARY[parameter];
  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        title={`What is ${entry.name}?`}
        aria-label={`What is ${entry.name}?`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/30 align-middle font-mono text-[10px] leading-none text-white/50 transition-colors hover:border-white/60 hover:text-white ${className}`}
      >
        i
      </button>
      {open && <MeasurementDialog parameter={parameter} onClose={() => onOpenChange(false)} />}
    </>
  );
}
