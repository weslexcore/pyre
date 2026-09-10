// Supabase access for schedule_lint_rules. Tiny on purpose: rows are the
// admins' configuration, read once per lint run and edited from the page.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleLintRuleRow } from '@/lib/db';

const TABLE = 'schedule_lint_rules';

const fail = (error: PostgrestError): never => {
  throw new Error(`schedule_lint_rules: ${error.message}`);
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
