// From saved rows to runnable rules, and the validation the admin page and
// the API share. Pure: no I/O, so the same code runs in the island (to
// summarise settings) and on the server (to refuse bad ones).
//
// Built-ins always exist. A row with the built-in's kind as its id overrides
// its enabled flag and settings; no row means defaults, enabled. Custom rows
// are instances of a custom kind, as many as the admins like.

import type { ScheduleLintRuleRow } from '@/lib/db';
import { SESSION_TYPES } from '@/lib/momence-events';
import { formatClockLabel, formatDurationLabel } from './labels';
import { BUILT_IN_DEFINITIONS, definitionFor, type RuleDefinition } from './rules';
import {
  DAY_KEYS,
  type DayKey,
  type DayWindow,
  type OpeningHours,
  type ParamField,
  type RuleInstance,
} from './types';

export const LABEL_MAX = 80;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY_SHORT: Record<DayKey, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

export type ParamsResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string };

function normalizeWindow(raw: unknown, day: string): DayWindow | null | string {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'object') return `${day}: expected open and close times`;
  const { open, close } = raw as Record<string, unknown>;
  if (typeof open !== 'string' || !HHMM.test(open)) return `${day}: opening time must be HH:MM`;
  if (typeof close !== 'string' || !HHMM.test(close)) return `${day}: closing time must be HH:MM`;
  if (close <= open) return `${day}: closing time must be after opening time`;
  return { open, close };
}

function normalizeField(field: ParamField, raw: unknown): { value: unknown } | { error: string } {
  switch (field.type) {
    case 'number': {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isInteger(n)) {
        return { error: `${field.label} must be a whole number` };
      }
      if (field.min !== undefined && n < field.min) {
        return { error: `${field.label} must be at least ${field.min}` };
      }
      if (field.max !== undefined && n > field.max) {
        return { error: `${field.label} must be at most ${field.max}` };
      }
      return { value: n };
    }
    case 'text': {
      if (typeof raw !== 'string') return { error: `${field.label} must be text` };
      const value = raw.trim();
      if (!value && !field.optional) return { error: `${field.label} is required` };
      if (value.length > 120) return { error: `${field.label} is too long` };
      return { value };
    }
    case 'boolean':
      return { value: raw === true || raw === 'true' };
    case 'type': {
      if (typeof raw !== 'string' || !SESSION_TYPES.includes(raw.trim().toLowerCase())) {
        return { error: `${field.label} must be one of ${SESSION_TYPES.join(', ')}` };
      }
      return { value: raw.trim().toLowerCase() };
    }
    case 'types': {
      if (!Array.isArray(raw)) return { error: `${field.label} must be a list of session types` };
      const values: string[] = [];
      for (const item of raw) {
        if (typeof item !== 'string') return { error: `${field.label} must be session types` };
        const type = item.trim().toLowerCase();
        if (!SESSION_TYPES.includes(type))
          return { error: `${field.label}: unknown type "${item}"` };
        if (!values.includes(type)) values.push(type);
      }
      return { value: values };
    }
    case 'durations': {
      // The form sends what was typed ("60, 120"); the API may send the list.
      const items = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(',').filter((part) => part.trim() !== '')
          : null;
      if (!items) return { error: `${field.label} must be a list of lengths in minutes` };
      const values: number[] = [];
      for (const item of items) {
        const n = typeof item === 'string' ? Number(item.trim()) : item;
        if (typeof n !== 'number' || !Number.isInteger(n)) {
          return { error: `${field.label} must be whole numbers of minutes` };
        }
        if (field.min !== undefined && n < field.min) {
          return { error: `${field.label}: each length must be at least ${field.min} minutes` };
        }
        if (field.max !== undefined && n > field.max) {
          return { error: `${field.label}: each length must be at most ${field.max} minutes` };
        }
        if (!values.includes(n)) values.push(n);
      }
      if (values.length === 0) return { error: `${field.label} needs at least one length` };
      return { value: values.sort((a, b) => a - b) };
    }
    case 'opening-hours': {
      if (!raw || typeof raw !== 'object') return { error: `${field.label} must list each day` };
      const source = raw as Record<string, unknown>;
      const days = {} as OpeningHours;
      for (const day of DAY_KEYS) {
        const window = normalizeWindow(source[day], DAY_SHORT[day]);
        if (typeof window === 'string') return { error: window };
        days[day] = window;
      }
      return { value: days };
    }
  }
}

/**
 * Validate raw settings against a definition's fields. Missing keys take the
 * default, so a rule saved before a field was added keeps working; a wrong
 * value is an error naming the field, never a silent default.
 */
export function normalizeParams(def: RuleDefinition, raw: unknown): ParamsResult {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const params: Record<string, unknown> = {};
  for (const field of def.fields) {
    const value = field.key in source ? source[field.key] : def.defaults[field.key];
    const result = normalizeField(field, value);
    if ('error' in result) return { ok: false, error: result.error };
    params[field.key] = result.value;
  }
  return { ok: true, params };
}

export function normalizeLabel(raw: unknown, fallback: string): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  return (label || fallback).slice(0, LABEL_MAX);
}

/** Every built-in with its defaults, enabled — what runs when nothing is saved. */
export function defaultRules(): RuleInstance[] {
  return BUILT_IN_DEFINITIONS.map((def) => ({
    id: def.kind,
    kind: def.kind,
    label: def.title,
    enabled: true,
    params: { ...def.defaults },
    builtIn: true,
  }));
}

/**
 * Saved rows to runnable rules: built-ins first (overridden by their row,
 * if any), then custom rows in creation order. A row whose kind is unknown
 * or whose settings no longer validate is skipped with a warning rather
 * than taking the whole lint down.
 */
export function resolveRules(rows: ScheduleLintRuleRow[]): RuleInstance[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rules: RuleInstance[] = [];

  for (const def of BUILT_IN_DEFINITIONS) {
    const row = byId.get(def.kind);
    const base = { id: def.kind, kind: def.kind, label: def.title, builtIn: true };
    if (!row) {
      rules.push({ ...base, enabled: true, params: { ...def.defaults } });
      continue;
    }
    const result = normalizeParams(def, row.params);
    if (!result.ok) {
      console.warn(`[schedule-lint] ${def.kind}: ${result.error}; using defaults`);
    }
    rules.push({
      ...base,
      label: normalizeLabel(row.label, def.title),
      enabled: row.enabled,
      params: result.ok ? result.params : { ...def.defaults },
    });
  }

  const custom = rows
    .filter((r) => !BUILT_IN_DEFINITIONS.some((d) => d.kind === r.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const row of custom) {
    const def = definitionFor(row.kind);
    if (!def || def.builtIn) {
      console.warn(`[schedule-lint] rule ${row.id}: unknown kind "${row.kind}"; skipped`);
      continue;
    }
    const result = normalizeParams(def, row.params);
    if (!result.ok) {
      console.warn(`[schedule-lint] rule ${row.id} (${row.label}): ${result.error}; skipped`);
      continue;
    }
    rules.push({
      id: row.id,
      kind: def.kind,
      label: normalizeLabel(row.label, def.title),
      enabled: row.enabled,
      params: result.params,
      builtIn: false,
    });
  }

  return rules;
}

/** One line describing a rule's settings, for the list view. */
export function summarizeParams(def: RuleDefinition, params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of def.fields) {
    const value = params[field.key];
    switch (field.type) {
      case 'number':
        parts.push(`${field.label}: ${value}`);
        break;
      case 'text':
        parts.push(`${field.label}: ${value ? `"${value}"` : '—'}`);
        break;
      case 'boolean':
        parts.push(`${field.label}: ${value ? 'yes' : 'no'}`);
        break;
      case 'type':
        parts.push(`${field.label}: ${value}`);
        break;
      case 'types': {
        const list = Array.isArray(value) ? value : [];
        parts.push(`${field.label}: ${list.length ? list.join(', ') : 'any'}`);
        break;
      }
      case 'durations': {
        const list = Array.isArray(value) ? (value as number[]) : [];
        parts.push(`${field.label}: ${list.map(formatDurationLabel).join(', ') || '—'}`);
        break;
      }
      case 'opening-hours': {
        const days = value as OpeningHours;
        const open = DAY_KEYS.filter((d) => days?.[d]).map(
          (d) =>
            `${DAY_SHORT[d]} ${formatClockLabel((days[d] as DayWindow).open)}–${formatClockLabel(
              (days[d] as DayWindow).close
            )}`
        );
        parts.push(open.length ? open.join(' · ') : 'Closed every day');
        break;
      }
    }
  }
  return parts.join(' · ');
}
