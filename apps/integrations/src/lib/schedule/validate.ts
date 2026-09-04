// Shared field validation for shifts and assignments — used by the admin
// routes (cookie-authed edits) AND the agent proposals endpoint, so an
// AI-drafted shift passes exactly the same rules as a hand-entered one.

import {
  ASSIGNMENT_DUTIES,
  ASSIGNMENT_ROLES,
  type AssignmentDuty,
  type AssignmentRole,
  MAX_SHIFT_MIN,
  normalizeDuties,
  timeToMinutes,
} from '@pyre/schedule-core';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Validate shift fields present on `body` (camelCase API names) into snake
 * case columns. Returns the columns, or an error message string.
 */
export function parseShiftFields(body: Record<string, unknown>): Record<string, unknown> | string {
  const fields: Record<string, unknown> = {};

  if (body.shiftDate !== undefined) {
    if (typeof body.shiftDate !== 'string' || !DATE_RE.test(body.shiftDate)) {
      return 'shiftDate must be YYYY-MM-DD';
    }
    fields.shift_date = body.shiftDate;
  }
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 40) {
      return 'label must be 1-40 characters';
    }
    fields.label = body.label.trim();
  }
  for (const [key, column] of [
    ['startsAt', 'starts_at'],
    ['endsAt', 'ends_at'],
  ] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !TIME_RE.test(value)) return `${key} must be HH:MM`;
      fields[column] = value;
    }
  }
  if (body.staffNeeded !== undefined) {
    const n = body.staffNeeded;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 20) {
      return 'staffNeeded must be an integer between 0 and 20';
    }
    fields.staff_needed = n;
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return 'notes must be a string';
    fields.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'cancelled') {
      return "status must be 'active' or 'cancelled'";
    }
    fields.status = body.status;
  }

  if (typeof fields.starts_at === 'string' && typeof fields.ends_at === 'string') {
    const error = checkShiftWindow(fields.starts_at, fields.ends_at);
    if (error) return error;
  }

  return fields;
}

/**
 * The cross-field rules on a shift window: it runs forward, and no single
 * shift is longer than eight hours — a longer stretch is two shifts. Called
 * by parseShiftFields when both times arrive together, and by the PATCH
 * route when only one side changes. Returns the error message, or null.
 */
export function checkShiftWindow(startsAt: string, endsAt: string): string | null {
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) return 'endsAt must be after startsAt';
  if (timeToMinutes(endsAt) - timeToMinutes(startsAt) > MAX_SHIFT_MIN) {
    return `A shift can run at most ${MAX_SHIFT_MIN / 60} hours — split a longer one into two shifts`;
  }
  return null;
}

/** Validate assignment time/role/duties/notes fields. Same contract as parseShiftFields. */
export function parseAssignmentFields(
  body: Record<string, unknown>
): Record<string, unknown> | string {
  const fields: Record<string, unknown> = {};
  for (const [key, column] of [
    ['startsAt', 'starts_at'],
    ['endsAt', 'ends_at'],
  ] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !TIME_RE.test(value)) return `${key} must be HH:MM`;
      fields[column] = value;
    }
  }
  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !ASSIGNMENT_ROLES.includes(body.role as AssignmentRole)) {
      return `role must be one of: ${ASSIGNMENT_ROLES.join(', ')}`;
    }
    fields.role = body.role;
  }
  // Duties are a set, not a scalar: sending them at all replaces the whole
  // set (an empty array clears them). Normalising here — dedupe and canonical
  // phase order — keeps the stored array stable however it was clicked or
  // drafted, since the array check constraint can't do either.
  if (body.duties !== undefined) {
    if (!Array.isArray(body.duties)) return 'duties must be an array';
    const unknown = body.duties.find(
      (d) => typeof d !== 'string' || !ASSIGNMENT_DUTIES.includes(d as AssignmentDuty)
    );
    if (unknown !== undefined) {
      return `duties must each be one of: ${ASSIGNMENT_DUTIES.join(', ')}`;
    }
    fields.duties = normalizeDuties(body.duties as string[]);
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return 'notes must be a string';
    fields.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;
  }
  return fields;
}
