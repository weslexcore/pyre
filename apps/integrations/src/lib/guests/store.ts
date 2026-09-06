// The handful of reads every guest route needs. Server-only (takes a
// service-role client). Errors are logged and turned into empty results so a
// failed lookup degrades the page rather than 500ing it — the routes decide
// what to say about a blank.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestProfileFieldRow, GuestProfileNoteRow, GuestProfileRow } from '@/lib/db';

/** Every field, archived ones included, in display order. */
export async function loadFields(db: SupabaseClient): Promise<GuestProfileFieldRow[]> {
  const { data, error } = await db
    .from('guest_profile_fields')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) {
    console.error('[guests] fields read failed:', error.message);
    return [];
  }
  return (data ?? []) as GuestProfileFieldRow[];
}

export async function loadProfileByMemberId(
  db: SupabaseClient,
  memberId: string
): Promise<GuestProfileRow | null> {
  const { data, error } = await db
    .from('guest_profiles')
    .select('*')
    .eq('momence_member_id', memberId)
    .maybeSingle();
  if (error) {
    console.error('[guests] profile read failed:', error.message);
    return null;
  }
  return (data as GuestProfileRow | null) ?? null;
}

export async function loadProfileById(
  db: SupabaseClient,
  id: string
): Promise<GuestProfileRow | null> {
  const { data, error } = await db.from('guest_profiles').select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('[guests] profile read failed:', error.message);
    return null;
  }
  return (data as GuestProfileRow | null) ?? null;
}

/** A profile's notes, newest first. */
export async function loadNotes(
  db: SupabaseClient,
  profileId: string
): Promise<GuestProfileNoteRow[]> {
  const { data, error } = await db
    .from('guest_profile_notes')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[guests] notes read failed:', error.message);
    return [];
  }
  return (data ?? []) as GuestProfileNoteRow[];
}

/**
 * How many profiles hold an answer for each field key — the "12 answers"
 * line on the fields page, and the guard against deleting a field that is
 * in use. Profiles are a small table, so counting keys in one pass beats a
 * query per field.
 */
export async function countAnswers(db: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await db.from('guest_profiles').select('field_values');
  if (error) {
    console.error('[guests] answer count failed:', error.message);
    return {};
  }
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { field_values: Record<string, unknown> | null }[]) {
    for (const key of Object.keys(row.field_values ?? {})) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}
