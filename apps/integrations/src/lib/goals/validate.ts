// Request-body normalization for goals and their KPIs. Pure and
// client-bundle-safe: the forms import the same limits they are validated
// against, so the textarea and the 400 can never disagree.
//
// Identity and bookkeeping columns — created_by, updated_by, completed_by,
// measured_at, started_at — are set by the route from the session and are
// deliberately absent from every shape here. A request body must never be
// able to reach them.
//
// Patch shapes distinguish "absent" from "null": leaving `parentId` out of a
// PATCH leaves the parent alone, while sending `parentId: null` un-files the
// goal. Same for every nullable field, which is why they are read one by one
// rather than spread from the body.

import { isNoteDate } from '@/lib/shift-notes/validate';
import type { GoalStatusValue, KpiDirectionValue } from './types';
import { GOAL_LIMITS, isArea, isGoalStatus, isKpiDirection } from './types';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** A real YYYY-MM-DD date, re-exported so callers need one import. */
export const isYmd = isNoteDate;

/** Trimmed non-empty text within `max`, or null when it isn't usable. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** Trimmed text, or null for blank — how an optional field is cleared. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
}

/** An email as the column stores it: lowercased, and long enough to be one. */
function email(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.length >= 3 && trimmed.length <= 320 ? trimmed : undefined;
}

/**
 * A finite number, accepting the string a number input hands back. Returns
 * undefined for anything unusable, so a typo never lands as 0 — the one
 * coercion mistake that would quietly corrupt a KPI.
 */
export function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inKpiRange(value: number): boolean {
  return Math.abs(value) <= GOAL_LIMITS.kpiValue;
}

export interface GoalCreate {
  title: string;
  parent_id: string | null;
  description_md: string;
  status: GoalStatusValue;
  owner_email: string | null;
  area: string | null;
  target_date: string | null;
}

export function parseGoalCreate(body: Record<string, unknown>): ParseResult<GoalCreate> {
  const title = text(body.title, GOAL_LIMITS.title);
  if (!title) {
    return fail(`title must be 1–${GOAL_LIMITS.title} characters`);
  }

  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    if (!isUuid(body.parentId)) return fail('parentId must be a UUID');
    parentId = body.parentId;
  }

  let description = '';
  if (body.descriptionMd !== undefined && body.descriptionMd !== null) {
    if (typeof body.descriptionMd !== 'string') return fail('descriptionMd must be text');
    description = body.descriptionMd.trim();
    if (description.length > GOAL_LIMITS.description) {
      return fail(`descriptionMd must be ${GOAL_LIMITS.description} characters or fewer`);
    }
  }

  // A goal starts planned unless it is being written down mid-flight. It can
  // never be created completed: completion carries a name and a note, and
  // both come from the dedicated path.
  let status: GoalStatusValue = 'planned';
  if (body.status !== undefined) {
    if (!isGoalStatus(body.status)) return fail('status is not a goal status');
    if (body.status === 'completed') return fail('A new goal cannot start completed');
    status = body.status;
  }

  const owner = email(body.ownerEmail);
  if (owner === undefined && body.ownerEmail !== undefined) {
    return fail('ownerEmail must be an email address');
  }

  const area = optionalText(body.area, GOAL_LIMITS.area);
  if (area === undefined && body.area !== undefined) {
    return fail(`area must be ${GOAL_LIMITS.area} characters or fewer`);
  }
  if (area && !isArea(area)) return fail('area is not one of the known areas');

  let targetDate: string | null = null;
  if (body.targetDate !== undefined && body.targetDate !== null && body.targetDate !== '') {
    if (!isYmd(body.targetDate)) return fail('targetDate must be a YYYY-MM-DD date');
    targetDate = body.targetDate;
  }

  return {
    ok: true,
    value: {
      title,
      parent_id: parentId,
      description_md: description,
      status,
      owner_email: owner ?? null,
      area: area ?? null,
      target_date: targetDate,
    },
  };
}

export interface GoalPatch {
  title?: string;
  parent_id?: string | null;
  description_md?: string;
  status?: GoalStatusValue;
  owner_email?: string | null;
  area?: string | null;
  target_date?: string | null;
  sort_order?: number;
  completion_note?: string | null;
}

export function parseGoalPatch(body: Record<string, unknown>): ParseResult<GoalPatch> {
  const patch: GoalPatch = {};

  if (body.title !== undefined) {
    const title = text(body.title, GOAL_LIMITS.title);
    if (!title) return fail(`title must be 1–${GOAL_LIMITS.title} characters`);
    patch.title = title;
  }

  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === '') patch.parent_id = null;
    else if (!isUuid(body.parentId)) return fail('parentId must be a UUID or null');
    else patch.parent_id = body.parentId;
  }

  if (body.descriptionMd !== undefined) {
    if (typeof body.descriptionMd !== 'string') return fail('descriptionMd must be text');
    const description = body.descriptionMd.trim();
    if (description.length > GOAL_LIMITS.description) {
      return fail(`descriptionMd must be ${GOAL_LIMITS.description} characters or fewer`);
    }
    patch.description_md = description;
  }

  if (body.status !== undefined) {
    if (!isGoalStatus(body.status)) return fail('status is not a goal status');
    patch.status = body.status;
  }

  if (body.ownerEmail !== undefined) {
    const owner = email(body.ownerEmail);
    if (owner === undefined) return fail('ownerEmail must be an email address or null');
    patch.owner_email = owner;
  }

  if (body.area !== undefined) {
    const area = optionalText(body.area, GOAL_LIMITS.area);
    if (area === undefined) return fail(`area must be ${GOAL_LIMITS.area} characters or fewer`);
    if (area && !isArea(area)) return fail('area is not one of the known areas');
    patch.area = area;
  }

  if (body.targetDate !== undefined) {
    if (body.targetDate === null || body.targetDate === '') patch.target_date = null;
    else if (!isYmd(body.targetDate)) return fail('targetDate must be a YYYY-MM-DD date or null');
    else patch.target_date = body.targetDate;
  }

  if (body.sortOrder !== undefined) {
    const order = numberOf(body.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail('sortOrder must be a whole number');
    }
    patch.sort_order = order;
  }

  if (body.completionNote !== undefined) {
    const note = optionalText(body.completionNote, GOAL_LIMITS.completionNote);
    if (note === undefined) {
      return fail(`completionNote must be ${GOAL_LIMITS.completionNote} characters or fewer`);
    }
    patch.completion_note = note;
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change');
  return { ok: true, value: patch };
}

export interface KpiCreate {
  goal_id: string;
  name: string;
  unit: string | null;
  direction: KpiDirectionValue;
  start_value: number | null;
  target_value: number;
}

export function parseKpiCreate(body: Record<string, unknown>): ParseResult<KpiCreate> {
  if (!isUuid(body.goalId)) return fail('goalId must be a UUID');

  const name = text(body.name, GOAL_LIMITS.kpiName);
  if (!name) return fail(`name must be 1–${GOAL_LIMITS.kpiName} characters`);

  const unit = optionalText(body.unit, GOAL_LIMITS.kpiUnit);
  if (unit === undefined && body.unit !== undefined) {
    return fail(`unit must be ${GOAL_LIMITS.kpiUnit} characters or fewer`);
  }

  if (!isKpiDirection(body.direction)) return fail("direction must be 'at_least' or 'at_most'");

  const target = numberOf(body.targetValue);
  if (target === undefined || !inKpiRange(target)) return fail('targetValue must be a number');

  let start: number | null = null;
  if (body.startValue !== undefined && body.startValue !== null && body.startValue !== '') {
    const parsed = numberOf(body.startValue);
    if (parsed === undefined || !inKpiRange(parsed)) return fail('startValue must be a number');
    start = parsed;
  }

  return {
    ok: true,
    value: {
      goal_id: body.goalId,
      name,
      unit: unit ?? null,
      direction: body.direction,
      start_value: start,
      target_value: target,
    },
  };
}

export interface KpiPatch {
  name?: string;
  unit?: string | null;
  direction?: KpiDirectionValue;
  start_value?: number | null;
  target_value?: number;
  current_value?: number | null;
  sort_order?: number;
}

export function parseKpiPatch(body: Record<string, unknown>): ParseResult<KpiPatch> {
  const patch: KpiPatch = {};

  if (body.name !== undefined) {
    const name = text(body.name, GOAL_LIMITS.kpiName);
    if (!name) return fail(`name must be 1–${GOAL_LIMITS.kpiName} characters`);
    patch.name = name;
  }

  if (body.unit !== undefined) {
    const unit = optionalText(body.unit, GOAL_LIMITS.kpiUnit);
    if (unit === undefined) return fail(`unit must be ${GOAL_LIMITS.kpiUnit} characters or fewer`);
    patch.unit = unit;
  }

  if (body.direction !== undefined) {
    if (!isKpiDirection(body.direction)) return fail("direction must be 'at_least' or 'at_most'");
    patch.direction = body.direction;
  }

  if (body.startValue !== undefined) {
    if (body.startValue === null || body.startValue === '') patch.start_value = null;
    else {
      const parsed = numberOf(body.startValue);
      if (parsed === undefined || !inKpiRange(parsed)) {
        return fail('startValue must be a number or null');
      }
      patch.start_value = parsed;
    }
  }

  if (body.targetValue !== undefined) {
    const target = numberOf(body.targetValue);
    if (target === undefined || !inKpiRange(target)) return fail('targetValue must be a number');
    patch.target_value = target;
  }

  // The measurement itself. Clearing it back to null is how a number that
  // turned out to be wrong is withdrawn, rather than left standing as fact.
  if (body.currentValue !== undefined) {
    if (body.currentValue === null || body.currentValue === '') patch.current_value = null;
    else {
      const parsed = numberOf(body.currentValue);
      if (parsed === undefined || !inKpiRange(parsed)) {
        return fail('currentValue must be a number or null');
      }
      patch.current_value = parsed;
    }
  }

  if (body.sortOrder !== undefined) {
    const order = numberOf(body.sortOrder);
    if (order === undefined || !Number.isInteger(order)) {
      return fail('sortOrder must be a whole number');
    }
    patch.sort_order = order;
  }

  if (Object.keys(patch).length === 0) return fail('Nothing to change');
  return { ok: true, value: patch };
}

/**
 * The narrow path behind the goal page's "Update value" field: one number,
 * nothing else. Kept separate from parseKpiPatch so the inline control can't
 * be talked into moving the target as well as the measurement.
 */
export function parseKpiMeasure(body: Record<string, unknown>): ParseResult<number | null> {
  if (!('currentValue' in body)) return fail('currentValue is required');
  if (body.currentValue === null || body.currentValue === '') return { ok: true, value: null };
  const parsed = numberOf(body.currentValue);
  if (parsed === undefined || !inKpiRange(parsed)) {
    return fail('currentValue must be a number or null');
  }
  return { ok: true, value: parsed };
}
