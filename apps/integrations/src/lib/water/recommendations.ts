// Pure dosing-recommendation engine over the ops-manual charts in charts.ts.
// No I/O and no imports beyond the chart constants, so it runs identically in
// the browser island (instant feedback on "Check readings") and anywhere
// server-side, and is trivially unit-testable.

import {
  CHLORINE_RAISE_GRAMS,
  type ChartRow,
  HARD_LIMITS,
  type Parameter,
  PH_LOWER,
  PH_RAISE,
  PRODUCTS,
  SALT_DOSE_TO_PPM,
  SALT_GRAMS_PER_STEP,
  SALT_PPM_PER_STEP,
  TA_RAISE,
  TARGETS,
} from './charts';

export interface Readings {
  ta?: number | null;
  ph?: number | null;
  /** Free chlorine (FC) — the active sanitizer. */
  chlorine?: number | null;
  /** Combined chlorine (CC) — spent sanitizer (chloramines). */
  cc?: number | null;
  salt?: number | null;
}

/**
 * 'blocked' is advice that is deliberately *not* a dose: the reading is out of
 * range, but correcting it now would be wrong (today: pH while TA is off).
 * It never produces a dose draft — it tells the operator to stop and fix
 * something else first.
 */
export type Severity = 'info' | 'action' | 'blocked' | 'critical';

export interface Recommendation {
  parameter: Parameter;
  severity: Severity;
  /** Product to add; null when the advice isn't a dose (criticals, infos). */
  chemical: string | null;
  /** Chart dose; null when the advice isn't a dose. */
  grams: number | null;
  /** Why this fired, e.g. "TA 70 ppm is below the 80–120 ppm target". */
  reason: string;
  /** Extra operator guidance (close the tub, dose order, retest cadence). */
  instruction?: string;
}

/** How a single reading sits against its target range and hard limit. */
export type ReadingStatus = 'ok' | 'out-of-target' | 'critical';

export function classifyReading(parameter: Parameter, value: number): ReadingStatus {
  if (parameter === 'chlorine' && value > HARD_LIMITS.chlorine) return 'critical';
  if (parameter === 'salt' && value > HARD_LIMITS.salt) return 'critical';
  const [min, max] = TARGETS[parameter];
  return value >= min && value <= max ? 'ok' : 'out-of-target';
}

/** Verdict on whether guests could safely be in the water for a set of readings. */
export interface GuestSafety {
  /** False when at least one reading means the tub should have been closed. */
  safe: boolean;
  /** Plain-language reasons, one per breached guest-safety rule. */
  reasons: string[];
}

/**
 * Guest safety is narrower than "in target": it is only about whether a person
 * should have been in the water. Both failures are sanitizer failures —
 * chlorine over the hard limit burns skin and eyes, chlorine under the target
 * floor means the water was effectively unsanitized. Salt over its hard limit
 * is an equipment problem, not a guest one, so it is deliberately not here.
 * Readings that were not taken (null) can't prove anything and don't flag.
 */
export function getGuestSafety(readings: Readings): GuestSafety {
  const { chlorine } = readings;
  const reasons: string[] = [];

  if (chlorine != null) {
    const [chlorineMin] = TARGETS.chlorine;
    if (chlorine > HARD_LIMITS.chlorine) {
      reasons.push(
        `Free chlorine ${chlorine} ppm was above the ${HARD_LIMITS.chlorine} ppm safety limit — no guests should have been in the water.`
      );
    } else if (chlorine < chlorineMin) {
      reasons.push(
        `Free chlorine ${chlorine} ppm was below the ${chlorineMin} ppm minimum — the water was not sanitized.`
      );
    }
  }

  return { safe: reasons.length === 0, reasons };
}

// Nearest chart row to the reading; when two rows are equally close, take the
// smaller dose. "You can always add more; the only way to remove too much is
// draining water."
function nearestDoseConservative(chart: readonly ChartRow[], reading: number): number {
  let best = chart[0];
  for (const row of chart) {
    const distance = Math.abs(row.reading - reading);
    const bestDistance = Math.abs(best.reading - reading);
    if (distance < bestDistance || (distance === bestDistance && row.grams < best.grams)) {
      best = row;
    }
  }
  return best.grams;
}

const inTarget = (parameter: Parameter, value: number): boolean => {
  const [min, max] = TARGETS[parameter];
  return value >= min && value <= max;
};

const range = (parameter: Parameter): string => {
  const [min, max] = TARGETS[parameter];
  return `${min}–${max}`;
};

/**
 * House rule, worded the same everywhere it appears so staff read it as one
 * rule and not two pieces of advice: alkalinity first, pH only after it lands.
 */
export const TA_FIRST_INSTRUCTION = `FIX TOTAL ALKALINITY FIRST — do not adjust pH until TA is back in the ${range('ta')} ppm target.`;

export const PH_BLOCKED_INSTRUCTION =
  'DO NOT ADJUST pH — correct TA first, run the pumps ~15 minutes, then retest. pH usually follows TA back into range on its own; dose it only if it is still out after the retest.';

/**
 * Recommendations for a set of readings, criticals first, then dosing/info
 * rows in correction order (TA, then pH, then chlorine, then salt — TA
 * steadies pH, pH controls whether sanitizer works). Skipped (null) readings
 * produce nothing; all-in-range produces an empty array.
 */
export function getRecommendations(readings: Readings): Recommendation[] {
  const { ta, ph, chlorine, cc, salt } = readings;
  const criticals: Recommendation[] = [];
  const doses: Recommendation[] = [];

  if (chlorine != null && chlorine > HARD_LIMITS.chlorine) {
    criticals.push({
      parameter: 'chlorine',
      severity: 'critical',
      chemical: null,
      grams: null,
      reason: `Free chlorine ${chlorine} ppm is above the ${HARD_LIMITS.chlorine} ppm safety limit`,
      instruction:
        'CLOSE TUB — no guests in the water. Keep pumps running and retest every 30 minutes until chlorine is back in range.',
    });
  }

  if (salt != null && salt > HARD_LIMITS.salt) {
    criticals.push({
      parameter: 'salt',
      severity: 'critical',
      chemical: null,
      grams: null,
      reason: `Salt ${salt} ppm is above the ${HARD_LIMITS.salt} ppm limit (corrodes metal components)`,
      instruction: 'Drain some water and refill to dilute, then retest.',
    });
  }

  // TA is the gate on pH: alkalinity is what holds pH still, so pH dosed
  // against off-target TA bounces straight back and wastes product. Whenever
  // TA is off, its recommendation carries that rule and the pH block below
  // refuses to dose.
  const offTa = ta != null && !inTarget('ta', ta) ? ta : null;

  if (offTa != null) {
    const [taMin] = TARGETS.ta;
    if (offTa < taMin) {
      doses.push({
        parameter: 'ta',
        severity: 'action',
        chemical: PRODUCTS.taRaise,
        grams: nearestDoseConservative(TA_RAISE, offTa),
        reason: `TA ${offTa} ppm is below the ${range('ta')} ppm target`,
        instruction: TA_FIRST_INSTRUCTION,
      });
    } else {
      doses.push({
        parameter: 'ta',
        severity: 'info',
        chemical: null,
        grams: null,
        reason: `TA ${offTa} ppm is above the ${range('ta')} ppm target — no lowering chart; it drifts down on its own. Persistent: consult the manual.`,
        instruction: TA_FIRST_INSTRUCTION,
      });
    }
  }

  if (ph != null && !inTarget('ph', ph)) {
    const [, phMax] = TARGETS.ph;
    if (offTa != null) {
      // No dose, on purpose: pH is out of range but TA has to come back first.
      doses.push({
        parameter: 'ph',
        severity: 'blocked',
        chemical: null,
        grams: null,
        reason: `pH ${ph} is ${ph > phMax ? 'above' : 'below'} the ${range('ph')} target, but TA ${offTa} ppm is off — TA is what holds pH steady, so a pH dose now would drift right back.`,
        instruction: PH_BLOCKED_INSTRUCTION,
      });
    } else if (ph > phMax) {
      doses.push({
        parameter: 'ph',
        severity: 'action',
        chemical: PRODUCTS.phLower,
        grams: nearestDoseConservative(PH_LOWER, ph),
        reason: `pH ${ph} is above the ${range('ph')} target.`,
      });
    } else {
      const offChart = ph < PH_RAISE[PH_RAISE.length - 1].reading;
      doses.push({
        parameter: 'ph',
        severity: 'action',
        chemical: PRODUCTS.phRaise,
        grams: nearestDoseConservative(PH_RAISE, ph),
        reason: `pH ${ph} is below the ${range('ph')} target.${
          offChart ? ' Reading is below the chart — dosing the lowest row; retest and repeat.' : ''
        }`,
      });
    }
  }

  // The chart doses at "1 ppm or less" — exactly 1 is inside the 1–3 target
  // but still gets the dose, so this block isn't gated on the target range.
  if (chlorine != null && chlorine <= HARD_LIMITS.chlorine) {
    const [chlorineMin, chlorineMax] = TARGETS.chlorine;
    if (chlorine <= chlorineMin) {
      doses.push({
        parameter: 'chlorine',
        severity: 'action',
        chemical: PRODUCTS.sanitizer,
        grams: CHLORINE_RAISE_GRAMS,
        reason: `Free chlorine ${chlorine} ppm is at or below the ${range('chlorine')} ppm target floor`,
      });
    } else if (chlorine > chlorineMax) {
      doses.push({
        parameter: 'chlorine',
        severity: 'info',
        chemical: null,
        grams: null,
        reason: `Free chlorine ${chlorine} ppm is above the ${range('chlorine')} ppm target — no product lowers it; keep pumps running and retest.`,
      });
    }
  }

  // CC has no dose — shocking is the remedy (it burns off the chloramines
  // tying up the sanitizer). 0.5 ppm is the standard shock threshold.
  if (cc != null && !inTarget('cc', cc)) {
    doses.push({
      parameter: 'cc',
      severity: 'info',
      chemical: null,
      grams: null,
      reason: `Combined chlorine ${cc} ppm is above 0.5 ppm — spent sanitizer is building up; the tub is due for a shock.`,
    });
  }

  if (salt != null && salt <= HARD_LIMITS.salt && !inTarget('salt', salt)) {
    const [saltMin] = TARGETS.salt;
    if (salt < saltMin) {
      const grams = Math.floor((SALT_DOSE_TO_PPM - salt) / SALT_PPM_PER_STEP) * SALT_GRAMS_PER_STEP;
      doses.push({
        parameter: 'salt',
        severity: 'action',
        chemical: PRODUCTS.salt,
        grams,
        reason: `Salt ${salt} ppm is below the ${range('salt')} ppm target (dosing toward ${SALT_DOSE_TO_PPM} ppm)`,
      });
    } else {
      doses.push({
        parameter: 'salt',
        severity: 'info',
        chemical: null,
        grams: null,
        reason: `Salt ${salt} ppm is above the ${range('salt')} ppm target — it falls with splash-out and refills.`,
      });
    }
  }

  return [...criticals, ...doses];
}
