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
  chlorine?: number | null;
  salt?: number | null;
}

export type Severity = 'info' | 'action' | 'critical';

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
 * Recommendations for a set of readings, criticals first, then dosing/info
 * rows in correction order (TA, then pH, then chlorine, then salt — TA
 * steadies pH, pH controls whether sanitizer works). Skipped (null) readings
 * produce nothing; all-in-range produces an empty array.
 */
export function getRecommendations(readings: Readings): Recommendation[] {
  const { ta, ph, chlorine, salt } = readings;
  const criticals: Recommendation[] = [];
  const doses: Recommendation[] = [];

  if (chlorine != null && chlorine > HARD_LIMITS.chlorine) {
    criticals.push({
      parameter: 'chlorine',
      severity: 'critical',
      chemical: null,
      grams: null,
      reason: `Chlorine ${chlorine} ppm is above the ${HARD_LIMITS.chlorine} ppm safety limit`,
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

  if (ta != null && !inTarget('ta', ta)) {
    const [taMin] = TARGETS.ta;
    if (ta < taMin) {
      doses.push({
        parameter: 'ta',
        severity: 'action',
        chemical: PRODUCTS.taRaise,
        grams: nearestDoseConservative(TA_RAISE, ta),
        reason: `TA ${ta} ppm is below the ${range('ta')} ppm target`,
      });
    } else {
      doses.push({
        parameter: 'ta',
        severity: 'info',
        chemical: null,
        grams: null,
        reason: `TA ${ta} ppm is above the ${range('ta')} ppm target — no lowering chart; it drifts down on its own. Persistent: consult the manual.`,
      });
    }
  }

  if (ph != null && !inTarget('ph', ph)) {
    const [, phMax] = TARGETS.ph;
    const afterTa = doses.some((d) => d.parameter === 'ta' && d.severity === 'action')
      ? ' Add after the TA dose and ~15 minutes of circulation.'
      : '';
    if (ph > phMax) {
      doses.push({
        parameter: 'ph',
        severity: 'action',
        chemical: PRODUCTS.phLower,
        grams: nearestDoseConservative(PH_LOWER, ph),
        reason: `pH ${ph} is above the ${range('ph')} target.${afterTa}`,
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
        }${afterTa}`,
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
        reason: `Chlorine ${chlorine} ppm is at or below the ${range('chlorine')} ppm target floor`,
      });
    } else if (chlorine > chlorineMax) {
      doses.push({
        parameter: 'chlorine',
        severity: 'info',
        chemical: null,
        grams: null,
        reason: `Chlorine ${chlorine} ppm is above the ${range('chlorine')} ppm target — no product lowers it; keep pumps running and retest.`,
      });
    }
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
