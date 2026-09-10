// Supabase access for schedule_lint_rules. Tiny on purpose: rows are the
// admins' configuration, read once per lint run and edited from the page.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleLintResolutionRow, ScheduleLintRuleRow } from '@/lib/db';

const TABLE = 'schedule_lint_rules';
const RESOLUTIONS = 'schedule_lint_resolutions';

const fail = (error: PostgrestError): never => {
  throw new Error(`schedule_lint_rules: ${error.message}`);
};

const failResolutions = (error: PostgrestError): never => {
  throw new Error(`schedule_lint_resolutions: ${error.message}`);
};

export async function listRuleRows(db: SupabaseClient): Promise<ScheduleLintRuleRow[]> {
  const { data, error } = await db.from(TABLE).select('*').order('created_at');
  if (error) fail(error);
  return (data ?? []) as ScheduleLintRuleRow[];
}

export async function findRuleRow(
  db: SupabaseClient,
  id: string
): Promise<ScheduleLintRuleRow | null> {
  const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return (data as ScheduleLintRuleRow | null) ?? null;
}

export interface SaveRuleInput {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  params: Record<string, unknown>;
  actor: string;
}

/** Insert or replace one rule row (built-in override or custom rule). */
export async function saveRuleRow(
  db: SupabaseClient,
  input: SaveRuleInput
): Promise<ScheduleLintRuleRow> {
  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        id: input.id,
        kind: input.kind,
        label: input.label,
        enabled: input.enabled,
        params: input.params,
        updated_by: input.actor,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();
  if (error) fail(error);
  return data as ScheduleLintRuleRow;
}

export async function deleteRuleRow(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) fail(error);
}

// --- Resolutions ------------------------------------------------------------

/** How long a resolution outlives the last run that raised its finding. */
export const RESOLUTION_TTL_DAYS = 30;

export async function listResolutions(db: SupabaseClient): Promise<ScheduleLintResolutionRow[]> {
  const { data, error } = await db
    .from(RESOLUTIONS)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) failResolutions(error);
  return (data ?? []) as ScheduleLintResolutionRow[];
}

export interface ResolveInput {
  key: string;
  ruleId: string;
  summary: string;
  note: string | null;
  actor: string;
}

/**
 * Mark one finding resolved, or refresh an existing entry. `last_seen_at`
 * starts at now so a resolution made between runs is not pruned before the
 * run that would have raised it again.
 */
export async function saveResolution(
  db: SupabaseClient,
  input: ResolveInput
): Promise<ScheduleLintResolutionRow> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from(RESOLUTIONS)
    .upsert(
      {
        key: input.key,
        rule_id: input.ruleId,
        summary: input.summary,
        note: input.note,
        resolved_by: input.actor,
        last_seen_at: now,
      },
      { onConflict: 'key' }
    )
    .select('*')
    .single();
  if (error) failResolutions(error);
  return data as ScheduleLintResolutionRow;
}

export async function deleteResolution(db: SupabaseClient, key: string): Promise<void> {
  const { error } = await db.from(RESOLUTIONS).delete().eq('key', key);
  if (error) failResolutions(error);
}

/** Every resolution a deleted rule left behind; its findings can never recur. */
export async function deleteResolutionsForRule(db: SupabaseClient, ruleId: string): Promise<void> {
  const { error } = await db.from(RESOLUTIONS).delete().eq('rule_id', ruleId);
  if (error) failResolutions(error);
}

/**
 * Keep the resolutions this run raised again, drop the ones nothing has
 * raised in RESOLUTION_TTL_DAYS. Called after a run with the keys that came
 * back resolved; returns how many rows were pruned.
 */
export async function touchResolutions(db: SupabaseClient, keys: string[]): Promise<number> {
  const now = new Date();
  if (keys.length > 0) {
    const { error } = await db
      .from(RESOLUTIONS)
      .update({ last_seen_at: now.toISOString() })
      .in('key', keys);
    if (error) failResolutions(error);
  }
  const cutoff = new Date(now.getTime() - RESOLUTION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await db
    .from(RESOLUTIONS)
    .delete()
    .lt('last_seen_at', cutoff.toISOString())
    .select('key');
  if (error) failResolutions(error);
  return (data ?? []).length;
}
