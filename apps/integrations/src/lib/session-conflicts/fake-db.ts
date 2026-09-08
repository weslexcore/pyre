// Test double for the Supabase query builder, shaped for the
// session_conflict_reviews store: records every insert/update payload and
// answers reads from a scripted table. Kept beside the tests that use it.
//
// Not a general Supabase mock — it understands exactly the chains the store
// builds (select/insert/update, eq/neq, order/limit, single/maybeSingle).

import { vi } from 'vitest';

export interface FakeRow {
  [key: string]: unknown;
  id: string;
  status: string;
}

interface Op {
  kind: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<{ op: 'eq' | 'neq'; column: string; value: unknown }>;
  limit?: number;
}

export function fakeDb(
  rows: FakeRow[] = [],
  options: { insertError?: { code: string; message: string } } = {}
) {
  const table: FakeRow[] = rows.map((r) => ({ ...r }));
  const inserts: Record<string, unknown>[] = [];
  const updates: Array<{ payload: Record<string, unknown>; filters: Op['filters'] }> = [];
  let seq = 1;

  const matches = (row: FakeRow, filters: Op['filters']) =>
    filters.every((f) => (f.op === 'eq' ? row[f.column] === f.value : row[f.column] !== f.value));

  const resolve = (op: Op) => {
    if (op.kind === 'insert') {
      if (options.insertError) return { data: null, error: options.insertError };
      const row = {
        id: `review-${seq++}`,
        status: 'pending',
        notified_count: 0,
        created_at: new Date().toISOString(),
        ...op.payload,
      } as FakeRow;
      table.push(row);
      inserts.push(op.payload ?? {});
      return { data: row, error: null };
    }
    if (op.kind === 'update') {
      const hit = table.filter((r) => matches(r, op.filters));
      for (const row of hit) Object.assign(row, op.payload);
      updates.push({ payload: op.payload ?? {}, filters: op.filters });
      return { data: hit.length === 1 ? hit[0] : hit.length === 0 ? null : hit, error: null };
    }
    const hit = table.filter((r) => matches(r, op.filters));
    return { data: op.limit ? hit.slice(0, op.limit) : hit, error: null };
  };

  function builder(op: Op) {
    const b = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        op.filters.push({ op: 'eq', column, value });
        return b;
      },
      neq: (column: string, value: unknown) => {
        op.filters.push({ op: 'neq', column, value });
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        op.limit = n;
        return b;
      },
      maybeSingle: async () => {
        const r = resolve(op);
        const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return { data, error: r.error };
      },
      single: async () => {
        const r = resolve(op);
        const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
        return { data, error: r.error };
      },
      // Awaiting the builder itself (no single/maybeSingle) resolves the op.
      // biome-ignore lint/suspicious/noThenProperty: the Supabase builder is thenable, so the fake must be too
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(op)).then(onOk, onErr),
    };
    return b;
  }

  const db = {
    from: vi.fn((_table: string) => ({
      select: () => builder({ kind: 'select', filters: [] }),
      insert: (payload: Record<string, unknown>) =>
        builder({ kind: 'insert', payload, filters: [] }),
      update: (payload: Record<string, unknown>) =>
        builder({ kind: 'update', payload, filters: [] }),
    })),
  };

  return { db, table, inserts, updates };
}
