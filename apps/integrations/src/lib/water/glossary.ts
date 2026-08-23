// Plain-language reference for the five readings on /admin/water, shown in the
// info modal behind the ⓘ next to each measurement. Written for whoever is on
// shift with a test kit in hand — what the number is, why it matters to a
// guest, how it moves the rest of the chemistry, and what to do when it's off.
//
// Like charts.ts and instructions.ts, this is the single place to edit when
// the house explanation changes; the numbers themselves are pulled from
// charts.ts so a target change can never leave this text stale.

import { HARD_LIMITS, type Parameter, PRODUCTS, TARGETS, TUB_GALLONS } from './charts';

export interface GlossaryEntry {
  /** Full name, as printed on the test kit. */
  name: string;
  /** Short form used on the log's reading chips. */
  chip: string;
  /** Target range with unit, e.g. "80–120 ppm". */
  target: string;
  /** The hard limit, for the two parameters that have one. */
  limit?: string;
  /** What the number actually measures. */
  what: string;
  /** Why it matters — to guests first, then to the tub. */
  why: string;
  /** How it moves, and how it pushes the other readings around. */
  chemistry: string;
  /** What to do when it reads out of range. */
  correcting: string;
}

const range = (parameter: Parameter, unit = ' ppm'): string =>
  `${TARGETS[parameter][0]}–${TARGETS[parameter][1]}${unit}`;

export const GLOSSARY: Record<Parameter, GlossaryEntry> = {
  ta: {
    name: 'Total Alkalinity',
    chip: 'TA',
    target: range('ta'),
    what: 'How much buffer the water is carrying — the dissolved carbonates that soak up acid or base before pH is able to move. Test it first, every time.',
    why: 'TA is what holds pH still. Run it low and pH bounces on anything you add and on any busy session, and the water turns aggressive — it starts pulling at metal fittings and at the shell. Run it high and pH locks high and keeps creeping up, which quietly weakens the sanitizer.',
    chemistry:
      'Every other reading sits downstream of this one, which is why it is both tested and corrected first. pH dosed while TA is off drifts straight back within hours and the product is wasted — so the log will not offer you a pH dose until TA is back inside its target.',
    correcting: `Below target: ${PRODUCTS.taRaise} at the chart dose, pumps ~15 minutes, then retest. Above target: there is no lowering product in the kit — TA drifts down on its own with use and refills. If it stays high, consult the manual.`,
  },
  ph: {
    name: 'pH',
    chip: 'pH',
    target: range('ph', ''),
    what: 'How acidic or basic the water is, on the 0–14 scale. 7 is neutral; the tub is run just above it, close to the pH of tears and skin.',
    why: 'Two things at once: comfort and sanitizer strength. Off-target pH stings eyes and dries skin — and it decides how much of your free chlorine is in its active, germ-killing form. The same 2 ppm chlorine reading kills far more slowly at pH 8.0 than at 7.4, so drifting pH quietly turns a good chlorine number into a weak one. Very low pH corrodes metal parts; very high scales them and clouds the water.',
    chemistry:
      'pH is usually the symptom and TA is the cause. Correct TA, circulate, retest — pH commonly walks back into range on its own with no pH product at all. Only dose pH when it is still out after TA has landed.',
    correcting: `Above target: ${PRODUCTS.phLower}. Below target: ${PRODUCTS.phRaise}. Chart dose either way, pumps ~15 minutes, then retest — and never while TA is off.`,
  },
  chlorine: {
    name: 'Free Chlorine (FC)',
    chip: 'FC',
    target: range('chlorine'),
    limit: `${HARD_LIMITS.chlorine} ppm — above this the tub closes`,
    what: "The sanitizer that is still unused and available to kill what guests bring into the water. 'Free' means it has not reacted with anything yet.",
    why: `This is the guest-safety number. Below the target floor the water is effectively unsanitized, however clear it looks. Above ${HARD_LIMITS.chlorine} ppm it burns eyes, skin and airways, and the tub stays closed until it comes down. Cold water does not sanitize itself — the bacteria guests carry in survive it perfectly well, and a plunge tub takes a heavy bather load in only ${TUB_GALLONS} gallons.`,
    chemistry:
      'Chlorine is only as strong as the pH lets it be, so an FC reading means what the pH says it means. It is consumed by every guest and by sunlight, so it falls fastest on the busiest days. Free plus combined is total chlorine.',
    correcting: `At or below the target floor: ${PRODUCTS.sanitizer} at the chart dose, pumps ~15 minutes, and retest before anyone gets in. Between the target top and the hard limit: nothing lowers it — keep the pumps running and let it fall. Above the hard limit: close the tub, pumps running, retest every 30 minutes.`,
  },
  cc: {
    name: 'Combined Chlorine (CC)',
    chip: 'CC',
    target: `at or below ${TARGETS.cc[1]} ppm (ideal is 0)`,
    what: 'Sanitizer that has already reacted with sweat, body oils, skin and ammonia and turned into chloramines. It is what you get by subtracting free chlorine from total chlorine.',
    why: 'Chloramines do not sanitize — they only irritate. The sharp "pool smell", red eyes and itchy skin people blame on too much chlorine are actually this: spent chlorine that has nowhere to go. Rising CC means sanitizer is being used up faster than it is being replaced.',
    chemistry:
      'Adding more routine sanitizer does not fix CC; it just adds more to be consumed. The remedy is shocking, which burns the chloramines off and frees the sanitizer to work again.',
    correcting: `Above ${TARGETS.cc[1]} ppm the tub is due for a shock: close it, dose ${PRODUCTS.sanitizer} + ${PRODUCTS.oxidizer}, leave the cover OFF for 20+ minutes with the pumps running, and reopen only once free chlorine is back inside its target.`,
  },
  salt: {
    name: 'Salt',
    chip: 'Salt',
    target: range('salt'),
    limit: `${HARD_LIMITS.salt} ppm — above this it corrodes metal components`,
    what: `The dissolved salt content of the water. The tubs are filled with ${PRODUCTS.salt} — roughly 920 g into a fresh ${TUB_GALLONS} gallon fill — and read with the TF-Pro Salt kit.`,
    why: 'It is most of what makes the water feel the way guests expect: softer on skin, easier on eyes and hair than plain tap water. Too much and it turns on the tub instead — salt at high concentration attacks jets, fittings and the chiller loop.',
    chemistry:
      'Salt does not evaporate. It leaves only by splash-out, by what guests carry out on skin and towels, and by draining — so it drifts down slowly and never climbs back on its own. It does no sanitizing of its own either; chlorine is dosed separately for that.',
    correcting: `Below target: ${PRODUCTS.salt} dosed toward the middle of the range, dissolved in a bucket of water first and poured in front of the filter basket. Above the hard limit: drain some water, refill to dilute, then retest.`,
  },
};
