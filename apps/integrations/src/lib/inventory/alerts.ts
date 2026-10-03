// Low-stock alerts. When a change takes an item from above its re-order level
// to at or below it, admins get one notification linking to the Re-order tab
// — unless the item is already on order. Only the crossing alerts (see
// crossedReorderLevel), so using more of an item that is already low stays
// quiet. Server-only; best-effort like every notifier: a failure is logged
// and never fails the stock change that caused it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import { createNotifications } from '@/lib/notifications/notify';
import { adminsPlus } from '@/lib/notifications/recipients';
import { daysFromNow } from '@/lib/notifications/types';
import { crossedReorderLevel, formatUnits, lotDescription, lotUnit, suggestedLots } from './rules';
import { type InventoryItemRow, REORDER_HREF } from './types';

const LOW_NOTICE_DAYS = 14;

type AlertItem = Pick<
  InventoryItemRow,
  | 'id'
  | 'name'
  | 'unit'
  | 'unit_plural'
  | 'reorder_level'
  | 'reorder_target'
  | 'lot_size'
  | 'lot_label'
  | 'lot_label_plural'
>;

/** Total on hand for an item across every spot; null when it can't be read. */
export async function itemTotal(db: SupabaseClient, itemId: string): Promise<number | null> {
  const { data, error } = await db.from('inventory_stock').select('quantity').eq('item_id', itemId);
  if (error) return null;
  return ((data ?? []) as { quantity: number }[]).reduce((sum, r) => sum + Number(r.quantity), 0);
}

export async function notifyIfLow(
  db: SupabaseClient,
  item: AlertItem,
  before: number,
  after: number,
  actorEmail: string
): Promise<void> {
  try {
    if (!crossedReorderLevel(item, before, after)) return;

    const { data: open } = await db
      .from('inventory_orders')
      .select('id')
      .eq('item_id', item.id)
      .eq('status', 'ordered')
      .limit(1);
    if ((open ?? []).length > 0) return;

    const rows = (await listStaff()) ?? [];
    const lots = suggestedLots(
      {
        reorder_level: Number(item.reorder_level),
        reorder_target: item.reorder_target == null ? null : Number(item.reorder_target),
        lot_size: Number(item.lot_size),
      },
      after
    );
    const suggestion =
      lots && lots > 0
        ? ` Suggested order: ${formatUnits(lots, lotUnit(item))}${lotDescription(item) ? ` (${lotDescription(item)})` : ''}.`
        : '';

    await createNotifications(db, adminsPlus(rows), {
      kind: 'inventory_low',
      title: `${item.name} is low`,
      body: `${formatUnits(after, item)} left (re-order at ${formatUnits(Number(item.reorder_level), item)}).${suggestion}`,
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
