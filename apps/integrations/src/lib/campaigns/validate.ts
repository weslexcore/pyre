// Shape-checking for campaign and link writes. Pure and client-bundle-safe:
// the form imports FIELD_LIMITS to cap its own inputs at the same numbers the
// server rejects at.
//
// `slug` is deliberately never read from a body: it is derived from the name
// at create time and locked afterwards, because every generated link and
// every PostHog join carries it. `status` is accepted on PATCH only.

import { type CustomUtm, resolveDestination } from './links';
import { type Placement, placementByKey } from './placements';
import { slugifyCampaign } from './slug';
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPES,
  type CampaignStatus,
  type CampaignType,
  type DestinationKind,
} from './types';

export const FIELD_LIMITS = {
  name: 80,
  notes: 1000,
  label: 120,
  variant: 40,
  customValue: 60,
  customUrl: 2048,
  destinationValue: 2048,
} as const;

export type Normalized<T> = { ok: true; value: T } | { ok: false; error: string };

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** '' or a real calendar date as YYYY-MM-DD; null when malformed. */
function date(value: unknown): string | null {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Reject things like 2026-02-31 that Date.parse quietly rolls forward.
  return new Date(ms).toISOString().slice(0, 10) === value ? value : null;
}

export interface CampaignInput {
  name: string;
  type: CampaignType;
  destinationKind: Exclude<DestinationKind, ''>;
  destinationValue: string;
  destinationUrl: string;
  startsAt: string;
  endsAt: string;
  notes: string;
}

function campaignType(value: unknown): CampaignType | null {
  return CAMPAIGN_TYPES.some((t) => t.key === value) ? (value as CampaignType) : null;
}

interface DestinationBody {
  kind?: unknown;
  value?: unknown;
}

function destination(
  body: unknown,
  origin: string
): Normalized<Pick<CampaignInput, 'destinationKind' | 'destinationValue' | 'destinationUrl'>> {
  const raw = (body ?? {}) as DestinationBody;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!['home', 'events', 'linktree', 'event', 'blog', 'partner', 'custom'].includes(kind)) {
    return { ok: false, error: 'Choose where the links should go' };
  }
  const value = text(raw.value, FIELD_LIMITS.destinationValue);
  const resolved = resolveDestination(origin, kind as DestinationKind, value);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return {
    ok: true,
    value: {
      destinationKind: kind as Exclude<DestinationKind, ''>,
      // Store the value the picker needs to re-select, not the resolved URL.
      destinationValue: kind === 'home' || kind === 'events' || kind === 'linktree' ? '' : value,
      destinationUrl: resolved.url,
    },
  };
}

function dateRange(
  body: Record<string, unknown>
): Normalized<{ startsAt: string; endsAt: string }> {
  const startsAt = date(body.startsAt);
  const endsAt = date(body.endsAt);
  if (startsAt === null || endsAt === null) {
    return { ok: false, error: 'Dates need to be real calendar dates' };
  }
  if (startsAt && endsAt && endsAt < startsAt) {
    return { ok: false, error: 'The campaign ends before it starts' };
  }
  return { ok: true, value: { startsAt, endsAt } };
}

/** A new campaign off the form. */
export function normalizeCampaignInput(
  body: Record<string, unknown>,
  origin: string
): Normalized<CampaignInput> {
  const name = text(body.name, FIELD_LIMITS.name);
  if (!name) return { ok: false, error: 'Give the campaign a name' };
  if (!slugifyCampaign(name)) {
    return { ok: false, error: 'The name needs at least one letter or number' };
  }

  const type = campaignType(body.type);
  if (!type) return { ok: false, error: 'Pick what kind of campaign this is' };

  const dest = destination(body.destination, origin);
  if (!dest.ok) return dest;

  const dates = dateRange(body);
  if (!dates.ok) return dates;

  return {
    ok: true,
    value: {
      name,
      type,
      ...dest.value,
      ...dates.value,
      notes: text(body.notes, FIELD_LIMITS.notes),
    },
  };
}

export type CampaignPatchInput = Partial<CampaignInput> & { status?: CampaignStatus };

/**
 * Edits to an existing campaign. Every field is optional; a `slug` in the
 * body is an error rather than ignored, so a client that thinks it can rename
 * the slug hears about it.
 */
export function normalizeCampaignPatch(
  body: Record<string, unknown>,
  origin: string
): Normalized<CampaignPatchInput> {
  if ('slug' in body) return { ok: false, error: 'slug_immutable' };

  const patch: CampaignPatchInput = {};

  if ('name' in body) {
    const name = text(body.name, FIELD_LIMITS.name);
    if (!name) return { ok: false, error: 'Give the campaign a name' };
    patch.name = name;
  }
  if ('type' in body) {
    const type = campaignType(body.type);
    if (!type) return { ok: false, error: 'Pick what kind of campaign this is' };
    patch.type = type;
  }
  if ('status' in body) {
    if (!CAMPAIGN_STATUSES.includes(body.status as CampaignStatus)) {
      return { ok: false, error: 'Status must be active or archived' };
    }
    patch.status = body.status as CampaignStatus;
  }
  if ('destination' in body) {
    const dest = destination(body.destination, origin);
    if (!dest.ok) return dest;
    Object.assign(patch, dest.value);
  }
  if ('startsAt' in body || 'endsAt' in body) {
    const dates = dateRange(body);
    if (!dates.ok) return dates;
    if ('startsAt' in body) patch.startsAt = dates.value.startsAt;
    if ('endsAt' in body) patch.endsAt = dates.value.endsAt;
  }
  if ('notes' in body) patch.notes = text(body.notes, FIELD_LIMITS.notes);

  return { ok: true, value: patch };
}

export interface LinkRequest {
  placement: Placement;
  variant: string;
  sourceOverride: string;
  custom: CustomUtm | null;
  /** Per-link destination override, already resolved; null to use the campaign's. */
  destination: { kind: Exclude<DestinationKind, ''>; value: string; url: string } | null;
  label: string;
}

/** A "generate this placement" request off the detail page. */
export function normalizeLinkRequest(
  body: Record<string, unknown>,
  origin: string
): Normalized<LinkRequest> {
  const key = typeof body.placementKey === 'string' ? body.placementKey : '';
  const placement = placementByKey(key);
  if (!placement) return { ok: false, error: 'Pick a placement from the list' };

  const variant = text(body.variant, FIELD_LIMITS.variant);

  let sourceOverride = '';
  if (placement.askSource) {
    sourceOverride = text(body.sourceOverride, FIELD_LIMITS.customValue);
    if (!sourceOverride)
      return { ok: false, error: `Enter the ${placement.askSource.toLowerCase()}` };
  }

  let custom: CustomUtm | null = null;
  if (placement.custom) {
    const raw = (body.custom ?? {}) as Record<string, unknown>;
    custom = {
      source: text(raw.source, FIELD_LIMITS.customValue),
      medium: text(raw.medium, FIELD_LIMITS.customValue),
      content: text(raw.content, FIELD_LIMITS.customValue),
      term: text(raw.term, FIELD_LIMITS.customValue),
    };
    if (!custom.source || !custom.medium) {
      return { ok: false, error: 'Custom links need a source and a medium' };
    }
  }

  let dest: LinkRequest['destination'] = null;
  if (body.destination != null) {
    const resolved = destination(body.destination, origin);
    if (!resolved.ok) return resolved;
    dest = {
      kind: resolved.value.destinationKind,
      value: resolved.value.destinationValue,
      url: resolved.value.destinationUrl,
    };
  }

  return {
    ok: true,
    value: {
      placement,
      variant,
      sourceOverride,
      custom,
      destination: dest,
      label: text(body.label, FIELD_LIMITS.label),
    },
  };
}
