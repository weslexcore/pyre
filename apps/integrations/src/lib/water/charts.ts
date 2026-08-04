// Cold-tub water chemistry constants for the two COLDTUB Icebreaker tubs
// (120 gal each), transcribed from the ops manual's dosing charts. This file
// is the single place to edit when the manual or house targets change —
// recommendations.ts holds the logic, this holds the numbers.
//
// Chart rows are kept exactly as printed; the (house-adjusted) target ranges
// are layered on top, so rows that fall inside a target simply never fire.

export const TUB_GALLONS = 120;

export const TUBS = ['left', 'right'] as const;
export type Tub = (typeof TUBS)[number];

export const ENTRY_TYPES = ['test', 'shock', 'refill'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const TEST_METHODS = ['strips', 'digital_meter', 'tf_pro_salt'] as const;
export type TestMethod = (typeof TEST_METHODS)[number];

export const TEST_METHOD_LABELS: Record<TestMethod, string> = {
  strips: 'Test strips',
  digital_meter: 'Digital meter',
  tf_pro_salt: 'TF-Pro Salt',
};

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

// Raise chlorine — "Cold Water Sanitizer": 1 ppm or less gets one flat dose.
export const CHLORINE_RAISE_GRAMS = 7;

// Raise salt — "Dead Sea Salt": 24 g raises ~50 ppm; dose to the target
// midpoint. Fresh fill is ~920 g total.
export const SALT_GRAMS_PER_STEP = 24;
export const SALT_PPM_PER_STEP = 50;
export const SALT_DOSE_TO_PPM = 2350;

// Weekly shock treatment: fixed pair, tub closed, cover off 20+ min, reopen
// only once chlorine is back in the 1–3 ppm range.
export const SHOCK_DOSES = [
  { chemical: PRODUCTS.sanitizer, grams: 10 },
  { chemical: PRODUCTS.oxidizer, grams: 30 },
] as const;
