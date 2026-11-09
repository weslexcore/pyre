// The staff row behind a dashboard login, for the employee self-service
// routes (sub requests, swap offers): the roster is matched by email, the
// same way the board works out `selfStaffId`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminGate } from '@/lib/auth/admin';
import type { StaffRow } from '@/lib/db';

/** The staff row matching the caller's login email, or null. */
export async function selfStaff(db: SupabaseClient, gate: AdminGate): Promise<StaffRow | null> {
  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return null;

  const { data } = await db.from('staff').select('*');
  const rows = (data ?? []) as StaffRow[];
  return rows.find((s) => (s.email ?? '').toLowerCase() === email) ?? null;
}
