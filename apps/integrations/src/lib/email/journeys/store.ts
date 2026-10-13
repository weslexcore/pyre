import { createWebhookLogger } from '@pyre/webhook-core';
import { cachedQuery } from '@/lib/cached-query';
import { getDb, type JourneyRevisionRow, type JourneyRow } from '@/lib/db';
import { unknownTokens } from './merge-fields';
import {
  definitionSchema,
  JOURNEY_ID_RE,
  type JourneyDefinition,
  type JourneyRecord,
} from './schema';

const log = createWebhookLogger('Journeys');

// The journeys table: what the engine runs and /admin/journeys edits. Reads
// for the engine go through a ~30s in-process cache (the same shape as the
// email gate); every mutation invalidates it. A row whose definition no
// longer parses is left out of the engine's list (and logged) rather than
// crashing every tick — the admin page shows it with the error.

/** Coded templates a step may send instead of blocks (the converted journeys). */
export const TEMPLATE_STEP_KEYS = [
  'intro-follow-up',
  'credit-pack-pitch',
  'membership-pitch',
  'review-request',
] as const;

export type TemplateStepKey = (typeof TEMPLATE_STEP_KEYS)[number];

export function isTemplateStepKey(key: string): key is TemplateStepKey {
  return (TEMPLATE_STEP_KEYS as readonly string[]).includes(key);
}

export function toRecord(row: JourneyRow): { record: JourneyRecord | null; error: string | null } {
  const parsed = definitionSchema.safeParse(row.definition);
  if (!parsed.success) {
    return { record: null, error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  return {
    record: {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      testMode: row.test_mode,
      archived: row.archived,
      revision: row.revision,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      definition: parsed.data,
    },
    error: null,
  };
}

const journeysCache = cachedQuery(async (): Promise<JourneyRecord[] | null> => {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from('journeys').select('*').eq('archived', false);
  if (error) {
    log.error(`Journeys fetch failed: ${error.message}`);
    return null;
  }
  const records: JourneyRecord[] = [];
  for (const row of data as JourneyRow[]) {
    const { record, error: parseError } = toRecord(row);
    if (record) records.push(record);
    else log.error(`Journey ${row.id} has an invalid definition — skipped: ${parseError}`);
  }
  return records;
});

/** Every non-archived journey with a valid definition, enabled or not. */
export async function loadJourneys({ fresh = false } = {}): Promise<JourneyRecord[]> {
  return (await journeysCache.get(fresh)) ?? [];
}

export function invalidateJourneysCache(): void {
  journeysCache.invalidate();
}

/** All rows for the admin list, including archived and unparseable ones. */
export async function listJourneyRows(): Promise<
  { row: JourneyRow; record: JourneyRecord | null; error: string | null }[]
> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db.from('journeys').select('*').order('name');
  if (error) throw new Error(error.message);
  return (data as JourneyRow[]).map((row) => ({ row, ...toRecord(row) }));
}

export async function getJourneyRow(id: string): Promise<JourneyRow | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from('journeys').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JourneyRow | null) ?? null;
}

export async function listRevisions(id: string): Promise<JourneyRevisionRow[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from('journey_revisions')
    .select('*')
    .eq('journey_id', id)
    .order('revision', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data as JourneyRevisionRow[];
}

// --- Validation beyond the schema ---

/**
 * Problems the zod schema can't see: unknown merge fields, unknown coded
 * templates, and steps that vanished since the last revision (members may be
 * waiting on them — archive instead).
 */
export function definitionProblems(
  definition: JourneyDefinition,
  previous: JourneyDefinition | null
): string[] {
  const problems: string[] = [];
  for (const step of definition.steps) {
    if (step.content.type === 'blocks') {
      const unknown = unknownTokens(step.content);
      if (unknown.length > 0) {
        problems.push(
          `Step "${step.name || step.key}" uses unknown merge field${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `{{${u}}}`).join(', ')}`
        );
      }
    }
    if (step.content.type === 'template' && !isTemplateStepKey(step.content.key)) {
      problems.push(`Step "${step.name || step.key}" uses unknown template "${step.content.key}"`);
    }
  }
  if (previous) {
    const keys = new Set(definition.steps.map((s) => s.key));
    for (const old of previous.steps) {
      if (!keys.has(old.key)) {
        problems.push(
          `Step "${old.name || old.key}" can't be removed - people may be waiting on it. Archive it instead.`
        );
      }
    }
  }
  return problems;
}

export type SaveResult =
  | { ok: true; row: JourneyRow }
  | { ok: false; status: number; error: string; issues?: string[] };

function parseDefinition(input: unknown): { definition: JourneyDefinition } | { issues: string[] } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map(
        (i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`
      ),
    };
  }
  return { definition: parsed.data };
}

export async function createJourney(
  input: { id: string; name: string; definition: unknown },
  actor: string | null
): Promise<SaveResult> {
  const db = getDb();
  if (!db) return { ok: false, status: 503, error: 'Storage unavailable' };
  if (!JOURNEY_ID_RE.test(input.id)) {
    return {
      ok: false,
      status: 400,
      error: 'The id must be 2-48 lowercase letters, numbers and dashes',
    };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: 'Give the journey a name' };

  const parsed = parseDefinition(input.definition);
  if ('issues' in parsed) {
    return { ok: false, status: 400, error: 'The journey is not valid', issues: parsed.issues };
  }
  const problems = definitionProblems(parsed.definition, null);
  if (problems.length > 0) {
    return { ok: false, status: 400, error: 'The journey is not valid', issues: problems };
  }

  const { data, error } = await db
    .from('journeys')
    .insert({
      id: input.id,
      name,
      definition: parsed.definition,
      enabled: false,
      test_mode: true,
      updated_by: actor,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        status: 409,
        error: `A journey with the id "${input.id}" already exists`,
      };
    }
    return { ok: false, status: 503, error: error.message };
  }

  const row = data as JourneyRow;
  await db.from('journey_revisions').insert({
    journey_id: row.id,
    revision: row.revision,
    name: row.name,
    definition: row.definition,
    edited_by: actor,
    note: 'Created',
  });
  invalidateJourneysCache();
  return { ok: true, row };
}

/**
 * Save a new definition (and/or name). Compare-and-swap on `revision`: a save
 * based on a stale copy fails with 409 instead of overwriting someone else's
 * edit.
 */
export async function saveJourney(
  id: string,
  input: { name?: string; definition: unknown; baseRevision: number; note?: string },
  actor: string | null
): Promise<SaveResult & { timingChanged?: string[] }> {
  const db = getDb();
  if (!db) return { ok: false, status: 503, error: 'Storage unavailable' };

  const current = await getJourneyRow(id);
  if (!current) return { ok: false, status: 404, error: 'Journey not found' };
  if (current.revision !== input.baseRevision) {
    return {
      ok: false,
      status: 409,
      error: 'Someone else saved this journey since you opened it. Reload to see their changes.',
    };
  }

  const parsed = parseDefinition(input.definition);
  if ('issues' in parsed) {
    return { ok: false, status: 400, error: 'The journey is not valid', issues: parsed.issues };
  }
  const previous = toRecord(current).record?.definition ?? null;
  const problems = definitionProblems(parsed.definition, previous);
  if (problems.length > 0) {
    return { ok: false, status: 400, error: 'The journey is not valid', issues: problems };
  }

  const name = input.name?.trim() || current.name;
  const nextRevision = current.revision + 1;
  const { data, error } = await db
    .from('journeys')
    .update({ name, definition: parsed.definition, revision: nextRevision, updated_by: actor })
    .eq('id', id)
    .eq('revision', current.revision)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: error.message };
  if (!data) {
    return {
      ok: false,
      status: 409,
      error: 'Someone else saved this journey since you opened it. Reload to see their changes.',
    };
  }

  const row = data as JourneyRow;
  await db.from('journey_revisions').insert({
    journey_id: id,
    revision: nextRevision,
    name,
    definition: parsed.definition,
    edited_by: actor,
    note: input.note?.trim() || null,
  });
  invalidateJourneysCache();

  // Steps whose timing changed: people waiting on them get rescheduled.
  const timingChanged = previous
    ? parsed.definition.steps
        .filter((step) => {
          const before = previous.steps.find((s) => s.key === step.key);
          return (
            before &&
            (before.timing.anchor !== step.timing.anchor ||
              before.timing.offsetHours !== step.timing.offsetHours)
          );
        })
        .map((s) => s.key)
    : [];

  return { ok: true, row, timingChanged };
}

export async function setJourneyFlags(
  id: string,
  flags: { enabled?: boolean; testMode?: boolean; archived?: boolean },
  actor: string | null
): Promise<SaveResult & { wasEnabled?: boolean }> {
  const db = getDb();
  if (!db) return { ok: false, status: 503, error: 'Storage unavailable' };
  const current = await getJourneyRow(id);
  if (!current) return { ok: false, status: 404, error: 'Journey not found' };

  const patch: Partial<JourneyRow> = { updated_by: actor };
  if (flags.enabled !== undefined) patch.enabled = flags.enabled;
  if (flags.testMode !== undefined) patch.test_mode = flags.testMode;
  if (flags.archived !== undefined) {
    patch.archived = flags.archived;
    // An archived journey can't keep running.
    if (flags.archived) patch.enabled = false;
  }

  const { data, error } = await db.from('journeys').update(patch).eq('id', id).select('*').single();
  if (error) return { ok: false, status: 503, error: error.message };
  invalidateJourneysCache();
  return { ok: true, row: data as JourneyRow, wasEnabled: current.enabled };
}
