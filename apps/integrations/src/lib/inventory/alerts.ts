// Low-stock alerts. When a count takes an item from above its re-order level
// to at or below it, admins get one notification linking to the list
// filtered to what needs re-ordering. Only the crossing alerts, so counting
// an item that is already low stays quiet. Server-only; best-effort like
// every notifier: a failure is logged and never fails the count.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import { createNotifications } from '@/lib/notifications/notify';
import { adminsPlus } from '@/lib/notifications/recipients';
import { daysFromNow } from '@/lib/notifications/types';
import { crossedReorderLevel, formatQuantity } from './rules';
import { type InventoryRow, REORDER_HREF } from './types';

const LOW_NOTICE_DAYS = 14;

export async function notifyIfLow(
  db: SupabaseClient,
  item: Pick<InventoryRow, 'id' | 'name' | 'reorder_at' | 'vendor'>,
  before: number,
  after: number,
  actorEmail: string
): Promise<void> {
  try {
    if (!crossedReorderLevel(item.reorder_at, before, after)) return;
    const rows = (await listStaff()) ?? [];
    await createNotifications(db, adminsPlus(rows), {
      kind: 'inventory_low',
      title: `${item.name} is low`,
      body: `${formatQuantity(after)} left (re-order at ${formatQuantity(Number(item.reorder_at))})${item.vendor ? ` · ${item.vendor}` : ''}.`,
      href: REORDER_HREF,
      source: { type: 'inventory_item', id: item.id },
      actorEmail,
      expiresAt: daysFromNow(LOW_NOTICE_DAYS),
      supersede: true,
    });
  } catch (error) {
    console.warn('[inventory] low-stock alert failed:', error);
  }
}
