// Validation for the duty list editor (/api/admin/shift-duties). Pure — the
// route does the reading and writing, this decides what a create or an edit
// turns into, and whether it keeps the list coherent:
//
//   - only set-up and break-down duties have an A/B side, and at most one
//     live duty holds each side of a phase (so "the matching half" is never
//     ambiguous — the DB's partial unique index is the backstop);
//   - a half's in-session default names a live, in-session duty;
//   - a session duty another half defaults to stays a session duty.
//
// Keys are derived from the label once and never change: they're what the
// duties[] arrays on every assignment store.

import {
  DUTY_PHASE_KEYS,
  DUTY_PHASE_LABELS,
  DUTY_SIDES,
  type DutyCatalog,
  type DutyPhaseKey,
  type DutySide,
  type ShiftDutyRow,
} from '@pyre/schedule-core';

export const DUTY_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The editable columns of a shift_duties row. */
export interface DutyColumns {
  label: string;
  detail: string | null;
  phase: DutyPhaseKey;
  side: DutySide | null;
  session_default: string | null;
  sop_id: string | null;
  archived: boolean;
}

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

/** "Opening Checks" -> "opening_checks", suffixed until it's free. */
export function keyFromLabel(label: string, taken: ReadonlySet<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  if (!/^[a-z]/.test(base)) base = `duty_${base}`.replace(/_+$/, '');
  if (base.length < 2) base = 'duty';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Read the fields present on `body` (camelCase API names) over `base`.
 * Returns an error string for the first malformed one.
 */
function readFields(body: Record<string, unknown>, base: DutyColumns): DutyColumns | string {
  const next = { ...base };
  if (body.label !== undefined) {
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label || label.length > 40) return 'label must be 1-40 characters';
    next.label = label;
  }
  if (body.detail !== undefined) {
    if (body.detail !== null && typeof body.detail !== 'string') return 'detail must be a string';
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (detail.length > 60) return 'detail must be at most 60 characters';
    next.detail = detail || null;
  }
  if (body.phase !== undefined) {
    if (!DUTY_PHASE_KEYS.includes(body.phase as DutyPhaseKey)) {
      return `phase must be one of: ${DUTY_PHASE_KEYS.join(', ')}`;
    }
    next.phase = body.phase as DutyPhaseKey;
  }
  if (body.side !== undefined) {
    if (body.side !== null && !DUTY_SIDES.includes(body.side as DutySide)) {
      return "side must be 'a', 'b' or null";
    }
    next.side = (body.side as DutySide | null) ?? null;
  }
  if (body.sessionDefault !== undefined) {
    if (body.sessionDefault !== null && typeof body.sessionDefault !== 'string') {
      return 'sessionDefault must be a duty key or null';
    }
    next.session_default = (body.sessionDefault as string | null) || null;
  }
  if (body.sopId !== undefined) {
    if (body.sopId !== null && (typeof body.sopId !== 'string' || !UUID_RE.test(body.sopId))) {
      return 'sopId must be an SOP id or null';
    }
    next.sop_id = (body.sopId as string | null) || null;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return 'archived must be true or false';
    next.archived = body.archived;
  }
  // A duty moved into the session phase can't keep the half-only settings.
  if (next.phase === 'session' && body.phase !== undefined && body.side === undefined) {
    next.side = null;
  }
  if (next.phase === 'session' && body.phase !== undefined && body.sessionDefault === undefined) {
    next.session_default = null;
  }
  return next;
}

/** The cross-row rules, checked against the rest of the list. */
function checkCoherent(key: string, cols: DutyColumns, catalog: DutyCatalog): string | null {
  if (cols.side && cols.phase === 'session') {
    return 'Only set-up and break-down duties can have an A/B side';
  }
  if (cols.session_default) {
    if (cols.phase === 'session') return 'An in-session duty has no in-session default';
    const target = catalog.find((d) => d.key === cols.session_default);
    if (!target || target.key === key || target.phase !== 'session' || target.archived) {
      return 'The in-session default must be a live in-session duty';
    }
  }
  if (cols.side && !cols.archived) {
    const clash = catalog.find(
      (d) => d.key !== key && !d.archived && d.phase === cols.phase && d.side === cols.side
    );
    if (clash) {
      return `${clash.label} is already the ${cols.side.toUpperCase()} side of ${DUTY_PHASE_LABELS[cols.phase]}. Archive it or pick the other side.`;
    }
  }
  if (cols.phase !== 'session') {
    const dependent = catalog.find((d) => d.key !== key && d.sessionDefault === key);
    if (dependent) {
      return `${dependent.label} defaults to this duty, so it has to stay in session. Change ${dependent.label} first.`;
    }
  }
  return null;
}

/** A new duty from a POST body: its key, and the columns to insert. */
export function normalizeDutyCreate(
  body: Record<string, unknown>,
  catalog: DutyCatalog
): Normalized<DutyColumns & { key: string }> {
  if (body.label === undefined) return { ok: false, error: 'label is required' };
  if (body.phase === undefined) return { ok: false, error: 'phase is required' };
  const cols = readFields(body, {
    label: '',
    detail: null,
    phase: 'session',
    side: null,
    session_default: null,
    sop_id: null,
    archived: false,
  });
  if (typeof cols === 'string') return { ok: false, error: cols };
  const key = keyFromLabel(cols.label, new Set(catalog.map((d) => d.key)));
  const incoherent = checkCoherent(key, cols, catalog);
  if (incoherent) return { ok: false, error: incoherent };
  return { ok: true, value: { key, ...cols } };
}

/** An edit from a PATCH body over the existing row: only the columns that change. */
export function normalizeDutyPatch(
  body: Record<string, unknown>,
  existing: ShiftDutyRow,
  catalog: DutyCatalog
): Normalized<Partial<DutyColumns>> {
  const base: DutyColumns = {
    label: existing.label,
    detail: existing.detail,
    phase: existing.phase,
    side: existing.side,
    session_default: existing.session_default,
    sop_id: existing.sop_id,
    archived: existing.archived,
  };
  const cols = readFields(body, base);
  if (typeof cols === 'string') return { ok: false, error: cols };
  const incoherent = checkCoherent(existing.key, cols, catalog);
  if (incoherent) return { ok: false, error: incoherent };
  const changes: Partial<DutyColumns> = {};
  for (const column of Object.keys(cols) as Array<keyof DutyColumns>) {
    if (cols[column] !== base[column]) (changes as Record<string, unknown>)[column] = cols[column];
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: 'No changes' };
  return { ok: true, value: changes };
}

/**
 * A re-order: the keys in their new order. Unknown keys are dropped and any
 * key left out is appended in its old place, so a stale client can't lose a
 * duty off the end. Null when `raw` isn't a list of strings.
 */
export function normalizeDutyOrder(raw: unknown, known: readonly string[]): string[] | null {
  if (!Array.isArray(raw) || raw.some((k) => typeof k !== 'string')) return null;
  const knownSet = new Set(known);
  const ordered = [...new Set(raw as string[])].filter((k) => knownSet.has(k));
  return [...ordered, ...known.filter((k) => !ordered.includes(k))];
}
