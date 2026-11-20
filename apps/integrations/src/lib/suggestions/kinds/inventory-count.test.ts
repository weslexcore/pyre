// inventory.count against a stand-in for the inventory table: a set lands as
// given (even when it matches the record, which still stamps the count), and
// a change lands on the stock as it stands when it is checked and applied —
// so a count approved in between is not overwritten.

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { AgentSuggestionRow } from '@/lib/db';
import type { InventoryRow } from '@/lib/inventory/types';
import { parsePayload } from '../types';
import { inventoryCount } from './inventory-count';

vi.mock('@/lib/inventory/history', () => ({ recordChange: vi.fn(async () => {}) }));
vi.mock('@/lib/inventory/alerts', () => ({ notifyIfLow: vi.fn(async () => {}) }));

const ITEM = '9d1e2f3a-4b5c-4d6e-8f70-112233445566';

/** Just the inventory reads and the one update the handler makes. */
function fakeDb(start: Partial<InventoryRow>) {
  const item = {
    id: ITEM,
    name: 'Bath Towels',
    active: true,
    in_stock: '2',
    reorder_at: null,
    last_counted_at: '2026-11-01T12:00:00Z',
    last_counted_by: 'jo@pyresauna.com',
    ...start,
  } as unknown as Record<string, unknown>;
  const db = {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === 'inventory' ? { data: { ...item } } : { data: null },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            select: () => ({
              maybeSingle: async () => {
                Object.assign(item, patch);
                return { data: { ...item }, error: null };
              },
            }),
          }),
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, item };
}

function payloadOf(raw: Record<string, unknown>) {
  const parsed = parsePayload('inventory.count', { itemId: ITEM, ...raw });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

const context = {
  suggestion: { id: 'sugg-1' } as AgentSuggestionRow,
  actor: 'admin@pyresauna.com',
  origin: null,
};

async function approve(db: SupabaseClient, raw: Record<string, unknown>) {
  const checked = await inventoryCount.validate(db, payloadOf(raw));
  if (!checked.ok) throw new Error(checked.error);
  await inventoryCount.apply(db, checked.payload, context);
  return checked.payload;
}

describe('inventory.count', () => {
  it('takes a number used off the stock: 2 on record, used 1 is 1', async () => {
    const { db, item } = fakeDb({ in_stock: 2 });
    const checked = await approve(db, { change: -1 });
    expect(checked.inStock).toBe(1);
    expect(item.in_stock).toBe(1);
  });

  it('adds a number received: 2 on record, got 1 is 3', async () => {
    const { db, item } = fakeDb({ in_stock: 2 });
    await approve(db, { change: 1 });
    expect(item.in_stock).toBe(3);
  });

  it('records a set that matches the record as a fresh count', async () => {
    const { db, item } = fakeDb({ in_stock: 2 });
    await approve(db, { inStock: 2, countedAt: '2026-11-20T01:25:00Z' });
    expect(item.in_stock).toBe(2);
    expect(item.last_counted_at).toBe('2026-11-20T01:25:00.000Z');
  });

  it('applies a change to the stock at approval, not when it was suggested', async () => {
    // Suggested against 57; another count took it to 145 before approval.
    const { db, item } = fakeDb({ in_stock: 145 });
    const checked = await approve(db, { change: -52, previousInStock: 57 });
    expect(checked.previousInStock).toBe(145);
    expect(item.in_stock).toBe(93);
  });

  it('refuses a change that would go below zero', async () => {
    const { db } = fakeDb({ in_stock: 1 });
    const checked = await inventoryCount.validate(db, payloadOf({ change: -2 }));
    expect(checked.ok).toBe(false);
  });
});
