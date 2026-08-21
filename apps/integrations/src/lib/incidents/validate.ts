// Request-body normalization for incident reports. One declarative field
// table drives both the create path (required fields enforced) and the patch
// path (only what was sent is touched), so the two can never disagree about
// what a field means or how long it may be.
//
// Client-bundle-safe on purpose: the form imports FIELD_LIMITS to cap its own
// textareas at the same numbers the server rejects at.
//
// Everything here is pure. Identity columns (reported_by, reviewed_by, and
// friends) are set by the route from the session and are deliberately absent
// from this table — a request body must never be able to reach them.

import {
  type AffectedPerson,
  BODY_PARTS,
  CONTRIBUTING_FACTORS,
  INCIDENT_AREAS,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  PERSON_ROLES,
  type PersonIdentity,
  type PersonRole,
  type Witness,
} from './types';

export const FIELD_LIMITS = {
  description: 8000,
  immediateActions: 4000,
  areaDetail: 300,
  equipmentInvolved: 300,
  firstAidBy: 200,
  followUpNotes: 4000,
  correctiveActions: 4000,
  resolutionNotes: 4000,
  personName: 200,
  personNotes: 1000,
  statement: 4000,
  note: 4000,
  caption: 300,
  shortText: 200,
} as const;

/** How far ahead of "now" an occurrence time may sit (clock skew only). */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
/** Reports older than this are almost certainly a mistyped year. */
const MAX_BACKDATE_MS = 365 * 24 * 60 * 60_000;

const MAX_PEOPLE = 12;
const MAX_WITNESSES = 12;
const MAX_STAFF_PRESENT = 20;

export type NormalizeResult<T> = { ok: true; value: T } | { ok: false; error: string };

type FieldKind =
  | 'text'
  | 'longtext'
  | 'bool'
  | 'nullable-bool'
  | 'timestamp'
  | 'temperature'
  | 'category'
  | 'severity'
  | 'area'
  | 'factors'
  | 'people'
  | 'witnesses'
  | 'staff';

interface FieldSpec {
  /** Column in public.incidents. */
  column: string;
  kind: FieldKind;
  /** Required on create (patches only validate what is present). */
  required?: boolean;
  max?: number;
}

// Body key (camelCase, what the island sends) -> column + rules.
const FIELDS: Record<string, FieldSpec> = {
  category: { column: 'category', kind: 'category', required: true },
  severity: { column: 'severity', kind: 'severity', required: true },
  occurredAt: { column: 'occurred_at', kind: 'timestamp', required: true },
  discoveredAt: { column: 'discovered_at', kind: 'timestamp' },
  area: { column: 'area', kind: 'area', required: true },
  areaDetail: { column: 'area_detail', kind: 'text', max: FIELD_LIMITS.areaDetail },
  description: {
    column: 'description',
    kind: 'longtext',
    required: true,
    max: FIELD_LIMITS.description,
  },
  immediateActions: {
    column: 'immediate_actions',
    kind: 'longtext',
    required: true,
    max: FIELD_LIMITS.immediateActions,
  },
  affectedPeople: { column: 'affected_people', kind: 'people' },
  witnesses: { column: 'witnesses', kind: 'witnesses' },
  staffPresent: { column: 'staff_present', kind: 'staff' },
  firstAidGiven: { column: 'first_aid_given', kind: 'bool' },
  firstAidBy: { column: 'first_aid_by', kind: 'text', max: FIELD_LIMITS.firstAidBy },
  emsCalled: { column: 'ems_called', kind: 'bool' },
  emsCalledAt: { column: 'ems_called_at', kind: 'timestamp' },
  policeCalled: { column: 'police_called', kind: 'bool' },
  transportedToHospital: { column: 'transported_to_hospital', kind: 'bool' },
  treatmentRefused: { column: 'treatment_refused', kind: 'bool' },
  guestLeftPremises: { column: 'guest_left_premises', kind: 'nullable-bool' },
  guestInformedOfReport: { column: 'guest_informed_of_report', kind: 'nullable-bool' },
  contributingFactors: { column: 'contributing_factors', kind: 'factors' },
  equipmentInvolved: {
    column: 'equipment_involved',
    kind: 'text',
    max: FIELD_LIMITS.equipmentInvolved,
  },
  saunaTempF: { column: 'sauna_temp_f', kind: 'temperature' },
  waterTempF: { column: 'water_temp_f', kind: 'temperature' },
  followUpRequired: { column: 'follow_up_required', kind: 'bool' },
  followUpNotes: { column: 'follow_up_notes', kind: 'longtext', max: FIELD_LIMITS.followUpNotes },
  correctiveActions: {
    column: 'corrective_actions',
    kind: 'longtext',
    max: FIELD_LIMITS.correctiveActions,
  },
  resolutionNotes: {
    column: 'resolution_notes',
    kind: 'longtext',
    max: FIELD_LIMITS.resolutionNotes,
  },
};

/** Body keys a manager may change after filing; the rest is the original record. */
export const REVIEW_ONLY_FIELDS = [
  'followUpRequired',
  'followUpNotes',
  'correctiveActions',
  'resolutionNotes',
] as const;

const trimTo = (value: string, max: number): string => value.trim().slice(0, max);

function normalizeField(key: string, spec: FieldSpec, raw: unknown): NormalizeResult<unknown> {
  const fail = (message: string): NormalizeResult<unknown> => ({
    ok: false,
    error: `${key}: ${message}`,
  });

  switch (spec.kind) {
    case 'text':
    case 'longtext': {
      if (raw === null) return { ok: true, value: null };
      if (typeof raw !== 'string') return fail('must be a string');
      const trimmed = trimTo(raw, spec.max ?? FIELD_LIMITS.shortText);
      if (!trimmed) return spec.required ? fail('is required') : { ok: true, value: null };
      return { ok: true, value: trimmed };
    }
    case 'bool': {
      if (typeof raw !== 'boolean') return fail('must be true or false');
      return { ok: true, value: raw };
    }
    case 'nullable-bool': {
      if (raw === null) return { ok: true, value: null };
      if (typeof raw !== 'boolean') return fail('must be true, false, or null');
      return { ok: true, value: raw };
    }
    case 'timestamp': {
      if (raw === null || raw === '') {
        return spec.required ? fail('is required') : { ok: true, value: null };
      }
      if (typeof raw !== 'string') return fail('must be an ISO timestamp');
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) return fail('is not a valid date and time');
      const now = Date.now();
      if (ms > now + FUTURE_TOLERANCE_MS) return fail('cannot be in the future');
      if (ms < now - MAX_BACKDATE_MS) return fail('is more than a year ago — check the date');
      return { ok: true, value: new Date(ms).toISOString() };
    }
    case 'temperature': {
      if (raw === null || raw === '') return { ok: true, value: null };
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return fail('must be a number');
      if (n < -50 || n > 500) return fail('must be between -50°F and 500°F');
      return { ok: true, value: Math.round(n * 10) / 10 };
    }
    case 'category':
      if (!(INCIDENT_CATEGORIES as readonly string[]).includes(raw as string)) {
        return fail('is not a recognized incident type');
      }
      return { ok: true, value: raw };
    case 'severity':
      if (!(INCIDENT_SEVERITIES as readonly string[]).includes(raw as string)) {
        return fail('is not a recognized severity');
      }
      return { ok: true, value: raw };
    case 'area':
      if (!(INCIDENT_AREAS as readonly string[]).includes(raw as string)) {
        return fail('is not a recognized area');
      }
      return { ok: true, value: raw };
    case 'factors': {
      if (!Array.isArray(raw)) return fail('must be a list');
      const allowed = CONTRIBUTING_FACTORS as readonly string[];
      const codes = [...new Set(raw.filter((v): v is string => typeof v === 'string'))];
      if (codes.some((c) => !allowed.includes(c))) return fail('contains an unknown factor');
      return { ok: true, value: codes };
    }
    case 'staff': {
      if (!Array.isArray(raw)) return fail('must be a list');
      const names = [
        ...new Set(
          raw
            .filter((v): v is string => typeof v === 'string')
            .map((v) => trimTo(v, FIELD_LIMITS.shortText))
            .filter(Boolean)
        ),
      ].slice(0, MAX_STAFF_PRESENT);
      return { ok: true, value: names };
    }
    case 'people': {
      if (!Array.isArray(raw)) return fail('must be a list');
      if (raw.length > MAX_PEOPLE) return fail(`cannot list more than ${MAX_PEOPLE} people`);
      const people: AffectedPerson[] = [];
      for (const entry of raw) {
        const person = normalizePerson(entry);
        // Blank rows are what an untouched "add another person" slot looks
        // like; drop them rather than making the reporter clean up.
        if (person) people.push(person);
      }
      return { ok: true, value: people };
    }
    case 'witnesses': {
      if (!Array.isArray(raw)) return fail('must be a list');
      if (raw.length > MAX_WITNESSES)
        return fail(`cannot list more than ${MAX_WITNESSES} witnesses`);
      const witnesses: Witness[] = [];
      for (const entry of raw) {
        const witness = normalizeWitness(entry);
        if (witness) witnesses.push(witness);
      }
      return { ok: true, value: witnesses };
    }
  }
}

/** Reader for the string fields every named person shares. */
function fieldReader(entry: Record<string, unknown>) {
  return (key: string, max: number = FIELD_LIMITS.shortText): string =>
    typeof entry[key] === 'string' ? trimTo(entry[key] as string, max) : '';
}

/**
 * The identity half of an affected person or a witness. `role` decides where
 * the form looked them up, but the stored record is the same either way: a
 * name, however we got it, plus whatever contact details came with it.
 */
function normalizeIdentity(e: Record<string, unknown>): PersonIdentity {
  const str = fieldReader(e);
  const role = (PERSON_ROLES as readonly string[]).includes(e.role as string)
    ? (e.role as PersonRole)
    : 'guest';

  return {
    role,
    name: str('name', FIELD_LIMITS.personName),
    phone: str('phone'),
    email: str('email').toLowerCase(),
    // Momence ids are numeric; anything else is a typo, not an id.
    memberId: /^\d+$/.test(str('memberId')) ? str('memberId') : '',
  };
}

const hasIdentity = (identity: PersonIdentity): boolean =>
  Boolean(identity.name || identity.phone || identity.email || identity.memberId);

function normalizePerson(entry: unknown): AffectedPerson | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const str = fieldReader(e);

  const bodyParts = Array.isArray(e.bodyParts)
    ? [
        ...new Set(
          e.bodyParts.filter(
            (p): p is AffectedPerson['bodyParts'][number] =>
              typeof p === 'string' && (BODY_PARTS as readonly string[]).includes(p)
          )
        ),
      ]
    : [];

  const person: AffectedPerson = {
    ...normalizeIdentity(e),
    injured: e.injured === true,
    injuryNature: str('injuryNature', FIELD_LIMITS.personNotes),
    bodyParts,
    notes: str('notes', FIELD_LIMITS.personNotes),
  };

  // "Nothing was filled in" — not even an unnamed injury. An entry that says
  // only "someone was hurt, no name" is still worth keeping.
  const hasContent =
    hasIdentity(person) || person.injuryNature || person.notes || person.bodyParts.length > 0;
  return hasContent ? person : null;
}

function normalizeWitness(entry: unknown): Witness | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;

  const witness: Witness = {
    ...normalizeIdentity(e),
    statement: fieldReader(e)('statement', FIELD_LIMITS.statement),
  };
  return hasIdentity(witness) || witness.statement ? witness : null;
}

/**
 * Full report from the filing form. Returns the column map to insert, with
 * defaults filled in for anything the form left out, or the first validation
 * error in a message a staff member can act on.
 */
export function normalizeIncidentSubmission(
  body: Record<string, unknown>
): NormalizeResult<Record<string, unknown>> {
  const row: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(FIELDS)) {
    const present = key in body && body[key] !== undefined;
    if (!present) {
      if (spec.required) return { ok: false, error: `${key} is required` };
      continue;
    }
    const result = normalizeField(key, spec, body[key]);
    if (!result.ok) return result;
    row[spec.column] = result.value;
  }

  for (const column of ['category', 'severity', 'occurred_at', 'area'] as const) {
    if (row[column] === null || row[column] === undefined) {
      return { ok: false, error: `${column} is required` };
    }
  }
  if (!row.description) return { ok: false, error: 'description is required' };
  if (!row.immediate_actions) {
    return { ok: false, error: 'immediateActions is required' };
  }

  // A timestamp for a call that was never made is noise in the record.
  if (row.ems_called !== true) row.ems_called_at = null;

  return { ok: true, value: row };
}

/**
 * Partial edit. Only the keys present in the body are returned, so a manager
 * correcting one field cannot blank out the rest of the record by omission.
 * `allowed` restricts which body keys are accepted (the reporter's amendment
 * window and a manager's review edit have different reach).
 */
export function normalizeIncidentPatch(
  body: Record<string, unknown>,
  allowed?: readonly string[]
): NormalizeResult<Record<string, unknown>> {
  const row: Record<string, unknown> = {};
  const allowSet = allowed ? new Set(allowed) : null;

  for (const [key, spec] of Object.entries(FIELDS)) {
    if (!(key in body) || body[key] === undefined) continue;
    if (allowSet && !allowSet.has(key)) {
      return { ok: false, error: `${key} cannot be changed after filing` };
    }
    const result = normalizeField(key, spec, body[key]);
    if (!result.ok) return result;
    // Required columns are non-null in the table; an edit may refine them but
    // never clear them.
    if (spec.required && (result.value === null || result.value === '')) {
      return { ok: false, error: `${key} cannot be emptied` };
    }
    row[spec.column] = result.value;
  }

  if (row.ems_called === false) row.ems_called_at = null;

  return { ok: true, value: row };
}

/**
 * Field-level before/after for the audit trail. Only genuinely changed
 * columns appear, so an idempotent save records nothing.
 */
export function diffIncidentFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [column, next] of Object.entries(patch)) {
    const prev = before[column] ?? null;
    const normalizedNext = next ?? null;
    if (JSON.stringify(prev) === JSON.stringify(normalizedNext)) continue;
    changes[column] = { from: prev, to: normalizedNext };
  }
  return changes;
}
