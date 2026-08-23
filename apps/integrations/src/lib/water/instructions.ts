// Step-by-step procedures from the COLDTUB Icebreaker ops manual, shown as an
// expandable panel on /admin/water when the matching entry type is selected.
// Like charts.ts, this is the single place to edit when the manual changes.

import type { EntryType } from './charts';

export interface InstructionSection {
  heading?: string;
  steps: string[];
}

export interface Instructions {
  title: string;
  sections: InstructionSection[];
  footnote?: string;
}

export const INSTRUCTIONS: Partial<Record<EntryType, Instructions>> = {
  shock: {
    title: 'How to shock the tub',
    sections: [
      {
        steps: [
          'Close the tub to guests.',
          'Test first, log it, and adjust. Shock works poorly in unbalanced water.',
          'Turn on the tub jets.',
          'Add the sanitizer + oxidizer.',
          'Leave the cover OFF for at least 20 minutes with the pumps running. Mandatory: the gases need to vent, and trapped gas destroys the underside of the cover.',
          'Put everything away.',
          'Wait at least 1 hour from adding the oxidizer, then retest TA and pH.',
          'Retest chlorine before reopening. The tub reopens only when chlorine is back in the 1–3 ppm range. Above 5 ppm: keep it closed, pumps running, retest every 30 minutes. Never let a guest in above 5 ppm.',
          'Log it: doses added, final readings, notes.',
        ],
      },
    ],
    footnote:
      'Closing for the night right after shocking? The tub can stay closed and chlorine drift down overnight, but the cover still stays off (or propped open) for the first 20+ minutes, and the opening shift must test before the first guest.',
  },
  refill: {
    title: 'How to drain + refill',
    sections: [
      {
        heading: 'Drain',
        steps: [
          'Trip the GFCI breaker (sub panel or quick disconnect). Power OFF before anything else.',
          'Cover the water probe!',
          'Locate the external drain on the side of the tub. Pull the nozzle out, remove the cap, hook up the hose.',
          'Push the nozzle in slightly to open the internal valve and drain.',
          'When empty, inspect and wipe down the shell with a soft cloth. No abrasives, solvents, alcohol, or household cleaners.',
          'Close the drain valve.',
        ],
      },
      {
        heading: 'Refill (water in BEFORE power on)',
        steps: [
          'Fill to halfway up the skimmer box (marked with arrow).',
          'Restore power (plug in, press GFCI Reset).',
          'Run each pump until jets are strong and steady (fully primed).',
          'Balance the fresh water: TA first, and only once TA is in range, pH.',
          'Add ~920 g Dead Sea Salt into a bucket with water and stir. Pour right in front of the filter basket.',
          'Set temperature; allow ~16 hours to stabilize. Cover on and locked.',
        ],
      },
    ],
    footnote:
      'Drain, clean, and refill on the schedule. Stretch to 6 weeks only if the water still balances easily and stays clear.',
  },
};
