// Cold-plunge water chemistry constants, transcribed from the COLDTUB
// Icebreaker ops manual's dosing charts. This file is the single place to edit
// when the manual or house targets change — recommendations.ts holds the
// logic, this holds the numbers.
//
// Chart rows are kept exactly as printed; the (house-adjusted) target ranges
// are layered on top, so rows that fall inside a target simply never fire.
// The plunges themselves (names, gallons) are rows in cold_plunges, managed on
// /admin/water/plunges.

/**
 * The volume every chart in this file is written for (one Icebreaker tub).
 * A plunge of a different size gets each amount scaled by gallons / 120.
 */
export const CHART_GALLONS = 120;

/**
 * A chart amount scaled to a plunge's volume, rounded DOWN to the nearest
 * 0.5 g ("you can always add more; the only way to remove too much is
 * draining water"), never below 0.5 g. At CHART_GALLONS it is the chart
 * amount unchanged.
 */
export function scaleGrams(grams: number, gallons: number): number {
  if (gallons === CHART_GALLONS) return grams;
  const scaled = Math.floor(((grams * gallons) / CHART_GALLONS) * 2) / 2;
  return Math.max(0.5, scaled);
}

export const ENTRY_TYPES = ['test', 'shock', 'refill', 'filter'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

// Entry types that record a maintenance visit rather than a reading panel:
// the water wasn't tested, so no readings and no test method land on the row.
export const MAINTENANCE_ENTRY_TYPES: readonly EntryType[] = ['refill', 'filter'];

export const hasReadingPanel = (entryType: EntryType): boolean =>
  !MAINTENANCE_ENTRY_TYPES.includes(entryType);

// What was done to the filter cartridge: hosed off and put back, or swapped
// for a new one. Only ever set on a 'filter' entry.
export const FILTER_ACTIONS = ['rinsed', 'changed'] as const;
export type FilterAction = (typeof FILTER_ACTIONS)[number];

export const FILTER_ACTION_LABELS: Record<FilterAction, string> = {
  rinsed: 'Rinsed',
  changed: 'Changed',
};

// Rinsing is the routine job and a change is the exception, so the form opens
// on it.
export const DEFAULT_FILTER_ACTION: FilterAction = 'rinsed';

export const TEST_METHODS = ['strips', 'digital_meter', 'tf_pro_salt'] as const;
export type TestMethod = (typeof TEST_METHODS)[number];

export const TEST_METHOD_LABELS: Record<TestMethod, string> = {
  strips: 'Test strips',
  digital_meter: 'Digital meter',
  tf_pro_salt: 'TF-Pro Salt',
};

// The TF-Pro Salt kit (Taylor reagents) is what staff test with day to day, so
// the entry form opens on it; strips are the exception, not the norm.
export const DEFAULT_TEST_METHOD: TestMethod = 'tf_pro_salt';

// 'chlorine' throughout the engine means FREE chlorine (FC) — the active
// sanitizer that strips report and the dosing chart targets. 'cc' is combined
// chlorine (chloramines) — spent sanitizer, total minus free.
export type Parameter = 'ta' | 'ph' | 'chlorine' | 'cc' | 'salt';

export const PRODUCTS = {
  taRaise: 'Cold Water Balance',
  phLower: 'Cold Water Run Down',
  phRaise: 'Cold Water Jump',
  sanitizer: 'Cold Water Sanitizer',
  salt: 'Dead Sea Salt',
  oxidizer: 'Oxidizer',
} as const;

// Target ranges [min, max]. TA and pH are house-adjusted (manual prints
// 120–180 and 7.2–7.6); chlorine (FC) and salt are as printed. The CC ceiling
// is the standard pool-operator shock threshold (0.5 ppm), not from the
// printed manual — CC's ideal is zero.
export const TARGETS: Record<Parameter, readonly [number, number]> = {
  ta: [80, 120],
  ph: [7.2, 7.8],
  chlorine: [1, 3],
  cc: [0, 0.5],
  salt: [2200, 2500],
};

// Guest-safety limits: chlorine above this closes the tub; salt above this
// corrodes metal components and calls for a partial drain + refill.
export const HARD_LIMITS = { chlorine: 5, salt: 3000 } as const;

export interface ChartRow {
  reading: number;
  grams: number;
}

// Raise TA — "Cold Water Balance" (rows at/above the 80 ppm target floor
// never fire with house targets).
export const TA_RAISE: readonly ChartRow[] = [
  { reading: 100, grams: 7 },
  { reading: 85, grams: 12 },
  { reading: 70, grams: 23 },
  { reading: 55, grams: 46 },
  { reading: 40, grams: 70 },
  { reading: 25, grams: 92 },
];

// Lower pH — "Cold Water Run Down". The manual's top row reads "8.2+:
// 23–28 g"; we use 23, the conservative end. Rows inside the 7.2–7.8 house
// target never fire.
export const PH_LOWER: readonly ChartRow[] = [
  { reading: 7.7, grams: 2.5 },
  { reading: 7.8, grams: 5 },
  { reading: 7.9, grams: 10 },
  { reading: 8.0, grams: 14 },
  { reading: 8.1, grams: 18 },
  { reading: 8.2, grams: 23 },
];

// Raise pH — "Cold Water Jump". Readings below the last row are off-chart;
// the engine clamps to the 6.8 row.
export const PH_RAISE: readonly ChartRow[] = [
  { reading: 7.1, grams: 6 },
  { reading: 7.0, grams: 7 },
  { reading: 6.9, grams: 10 },
  { reading: 6.8, grams: 11 },
];

// Raise chlorine — "Cold Water Sanitizer", 99% sodium dichloro-s-triazinetrione
// (dichlor). The manual prints one flat 7 g dose at "1 ppm or less", but in
// 120 gal that raises free chlorine ~9 ppm — past the 5 ppm limit that closes
// the tub, which is what staff saw. So the dose is computed instead: just
// enough to bring the reading up to CHLORINE_DOSE_TO_PPM.
//
// Anhydrous dichlor is ~62% available chlorine (the dihydrate ~56%). Using
// the stronger figure means a slightly smaller dose if the product is the
// weaker form, never a larger one.
export const DICHLOR_AVAILABLE_CHLORINE = 0.62;
export const LITERS_PER_GALLON = 3.785;

/** Free chlorine a sanitizer dose aims for: the middle of the 1–3 ppm target. */
export const CHLORINE_DOSE_TO_PPM = 2;

/** ppm of free chlorine one gram of sanitizer adds to a plunge of this size. */
export const sanitizerPpmPerGram = (gallons: number): number =>
  (1000 * DICHLOR_AVAILABLE_CHLORINE) / (gallons * LITERS_PER_GALLON);

/**
 * Sanitizer to bring free chlorine from `reading` up to CHLORINE_DOSE_TO_PPM,
 * rounded DOWN so it can't overshoot: to the nearest 0.5 g like every other
 * dose, or — when that rounds to nothing, which only happens in a small plunge
 * where half a gram alone could push past the limit — to the nearest 0.1 g.
 */
export function sanitizerGrams(reading: number, gallons: number): number {
  const raw = Math.max(0, CHLORINE_DOSE_TO_PPM - reading) / sanitizerPpmPerGram(gallons);
  const halves = Math.floor(raw * 2) / 2;
  if (halves > 0) return halves;
  return Math.max(0.1, Math.floor(raw * 10) / 10);
}

// Raise salt — "Dead Sea Salt": 24 g raises ~50 ppm; dose to the target
// midpoint.
export const SALT_GRAMS_PER_STEP = 24;
export const SALT_PPM_PER_STEP = 50;
export const SALT_DOSE_TO_PPM = 2350;

// Salt for a fresh fill of CHART_GALLONS.
export const FRESH_FILL_SALT_GRAMS = 920;

// Weekly shock treatment: oxidizer only (potassium peroxymonosulfate), tub
// closed, cover off 20+ min. The manual pairs it with 10 g of sanitizer, but
// that dichlor adds ~14 ppm free chlorine in 120 gal and kept the tub above
// the limit into the next day; the salt cell supplies the chlorine, and a low
// reading is topped up by the test that comes first, sized to ~2 ppm.
export const SHOCK_DOSES = [{ chemical: PRODUCTS.oxidizer, grams: 30 }] as const;

/** The shock dose sized for a plunge's volume. */
export const shockDoses = (gallons: number): { chemical: string; grams: number }[] =>
  SHOCK_DOSES.map((dose) => ({ chemical: dose.chemical, grams: scaleGrams(dose.grams, gallons) }));
