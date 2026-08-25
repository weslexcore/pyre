// Request validation for /api/admin/business-costs, kept out of the route so
// the kind-dependent rules (which columns each cost kind may use — mirroring
// the business_costs check constraints) can be unit tested directly.

export const COST_CATEGORIES = [
  'rent',
  'software',
  'supplies',
  'services',
  'fees',
  'other',
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_KINDS = ['recurring', 'one_off', 'per_open_hour', 'percent_of_revenue'] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_CADENCES = ['weekly', 'biweekly', 'monthly', 'yearly'] as const;
export type CostCadence = (typeof COST_CADENCES)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Generous sanity ceiling — nothing in this building costs a million a month. */
const MAX_AMOUNT = 1_000_000;

/** Column-shaped values ready for insert/update on business_costs. */
export interface CostRecord {
  name: string;
  category: CostCategory;
  kind: CostKind;
  amount: number;
  cadence: CostCadence | null;
  monthly_cap: number | null;
  incurred_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
}

type ParseResult = { record: CostRecord } | { error: string };

const asOptionalDate = (value: unknown, field: string): string | null | { error: string } => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return { error: `${field} must be a YYYY-MM-DD date` };
  }
  return value;
};

/** Validate a create/update body into a business_costs row, or explain why not. */
export function parseCostInput(body: Record<string, unknown>): ParseResult {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    return { error: 'name is required (max 120 chars)' };
  }

  const category = body.category;
  if (typeof category !== 'string' || !COST_CATEGORIES.includes(category as CostCategory)) {
    return { error: `category must be one of: ${COST_CATEGORIES.join(', ')}` };
  }

  const kind = body.kind;
  if (typeof kind !== 'string' || !COST_KINDS.includes(kind as CostKind)) {
    return { error: `kind must be one of: ${COST_KINDS.join(', ')}` };
  }

  const amount = body.amount;
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_AMOUNT
  ) {
    return { error: `amount must be a number between 0 and ${MAX_AMOUNT}` };
  }
  if (kind === 'percent_of_revenue' && amount > 100) {
    return { error: 'a percent_of_revenue amount is a percentage (at most 100)' };
  }

  let cadence: CostCadence | null = null;
  if (kind === 'recurring') {
    if (typeof body.cadence !== 'string' || !COST_CADENCES.includes(body.cadence as CostCadence)) {
      return { error: `a recurring cost needs a cadence: ${COST_CADENCES.join(', ')}` };
    }
    cadence = body.cadence as CostCadence;
  } else if (body.cadence != null) {
    return { error: 'cadence only applies to recurring costs' };
  }

  let monthlyCap: number | null = null;
  if (kind === 'per_open_hour') {
    if (body.monthlyCap != null) {
      const cap = body.monthlyCap;
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0 || cap > MAX_AMOUNT) {
        return { error: `monthlyCap must be a number between 0 and ${MAX_AMOUNT}` };
      }
      monthlyCap = cap;
    }
  } else if (body.monthlyCap != null) {
    return { error: 'monthlyCap only applies to per_open_hour costs' };
  }

  let incurredOn: string | null = null;
  if (kind === 'one_off') {
    const parsed = asOptionalDate(body.incurredOn, 'incurredOn');
    if (typeof parsed === 'object' && parsed !== null) return parsed;
    if (parsed === null) return { error: 'a one_off cost needs incurredOn (the purchase date)' };
    incurredOn = parsed;
  } else if (body.incurredOn != null) {
    return { error: 'incurredOn only applies to one_off costs' };
  }

  let effectiveFrom: string | null = null;
  let effectiveTo: string | null = null;
  if (kind === 'one_off') {
    if (body.effectiveFrom != null || body.effectiveTo != null) {
      return { error: 'a one_off cost has no effective window — it lands on incurredOn' };
    }
  } else {
    const from = asOptionalDate(body.effectiveFrom, 'effectiveFrom');
    if (typeof from === 'object' && from !== null) return from;
    const to = asOptionalDate(body.effectiveTo, 'effectiveTo');
    if (typeof to === 'object' && to !== null) return to;
    effectiveFrom = from;
    effectiveTo = to;
    if (effectiveFrom !== null && effectiveTo !== null && effectiveTo < effectiveFrom) {
      return { error: 'effectiveTo must not be before effectiveFrom' };
    }
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';

  return {
    record: {
      name,
      category: category as CostCategory,
      kind: kind as CostKind,
      amount,
      cadence,
      monthly_cap: monthlyCap,
      incurred_on: incurredOn,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      notes: notes || null,
    },
  };
}
