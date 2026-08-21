// Resolves a dashboard user's SOP role from their staff row: admins rank
// highest, then shift leads (is_shift_lead on the roster), then everyone else
// holding dashboard access. Server-only (reads the staff table via the cached
// roster in lib/auth/access).

import type { DashboardAccess } from '@/lib/auth/access';
import { listStaff } from '@/lib/auth/access';
import type { SopRole } from './levels';

export async function getSopRole(email: string | null, access: DashboardAccess): Promise<SopRole> {
  if (access.isAdmin) return 'admin';

  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return 'staff';

  const rows = await listStaff();
  const row = rows?.find((r) => r.email === normalized);
  return row?.is_shift_lead ? 'shift_lead' : 'staff';
}
