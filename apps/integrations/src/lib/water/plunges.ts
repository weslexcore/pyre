// Request-body normalisation for the cold plunge list (/admin/water/plunges),
// plus the small lookups the water log needs. Pure and dependency-free so the
// rules are testable without a database.

import type { ColdPlungeRow } from '@/lib/db';

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

export const PLUNGE_LIMITS = { name: 40, id: 40, maxGallons: 2000 } as const;

export const PLUNGE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A permanent id from a name: "Garden Plunge #2" -> "garden-plunge-2".
 * Ids never change once created (log entries store them), so this only runs
 * at creation.
 */
export function slugifyPlunge(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PLUNGE_LIMITS.id)
    .replace(/-+$/, '');
}

/**
 * The slug for a new plunge, suffixed when taken (archived plunges included —
 * their ids still have history): "left" -> "left-2".
 */
export function uniquePlungeId(name: string, taken: Iterable<string>): string {
  const base = slugifyPlunge(name) || 'plunge';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, PLUNGE_LIMITS.id - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, PLUNGE_LIMITS.name);
}

/** Gallons as a number to one decimal place, or null when not a usable volume. */
function cleanGallons(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 10) / 10;
  return rounded > 0 && rounded <= PLUNGE_LIMITS.maxGallons ? rounded : null;
}

const GALLONS_ERROR = `gallons must be a number above 0 and at most ${PLUNGE_LIMITS.maxGallons}`;

export interface PlungeCreate {
  name: string;
  gallons: number;
}

export function normalizePlungeCreate(body: Record<string, unknown>): Normalized<PlungeCreate> {
  const name = cleanName(body.name);
  if (!name) return { ok: false, error: `name is required (max ${PLUNGE_LIMITS.name} chars)` };
  const gallons = cleanGallons(body.gallons);
  if (gallons == null) return { ok: false, error: GALLONS_ERROR };
  return { ok: true, value: { name, gallons } };
}

export type PlungePatch = Partial<Pick<ColdPlungeRow, 'name' | 'gallons' | 'archived'>>;

/** An edit to an existing plunge; only the keys present in the body are touched. */
export function normalizePlungePatch(body: Record<string, unknown>): Normalized<PlungePatch> {
  const patch: PlungePatch = {};

  if ('name' in body) {
    const name = cleanName(body.name);
    if (!name) return { ok: false, error: 'name cannot be blank' };
    patch.name = name;
  }

  if ('gallons' in body) {
    const gallons = cleanGallons(body.gallons);
    if (gallons == null) return { ok: false, error: GALLONS_ERROR };
    patch.gallons = gallons;
  }

  if ('archived' in body) {
    if (typeof body.archived !== 'boolean')
      return { ok: false, error: 'archived must be true or false' };
    patch.archived = body.archived;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: patch };
}

/**
 * The complete list in its new order: unknown and repeated ids are dropped.
 * Null when nothing usable is left.
 */
export function normalizePlungeOrder(value: unknown, known: Iterable<string>): string[] | null {
  if (!Array.isArray(value)) return null;
  const knownSet = new Set(known);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !knownSet.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    order.push(entry);
  }
  return order.length > 0 ? order : null;
}

/** A plunge's display name, falling back to its id for one no longer listed. */
export function plungeName(
  plunges: readonly Pick<ColdPlungeRow, 'id' | 'name'>[],
  id: string
): string {
  return plunges.find((p) => p.id === id)?.name ?? id;
}

/** Gallons for display: "120", "87.5". */
export const formatGallons = (gallons: number): string =>
  Number.isInteger(gallons) ? String(gallons) : gallons.toFixed(1);
