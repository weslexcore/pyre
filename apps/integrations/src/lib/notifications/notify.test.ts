import { describe, expect, it } from 'vitest';
import { createNotifications } from './notify';

/**
 * A stand-in for the Supabase client: every call chains, and the two
 * terminal shapes (delete / insert) are recorded so the test can see what
 * would have been written.
 */
function fakeDb(opts: { failInsert?: boolean } = {}) {
  const calls: { op: string; args: unknown }[] = [];
  // Every builder method chains, and awaiting the chain resolves to the
  // outcome: the object is a real Promise with the query methods bolted on.
  const chain = (op: string) => {
    const result =
      op === 'insert' && opts.failInsert ? { error: { message: 'boom' } } : { error: null };
    const query = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
    for (const m of ['in', 'eq', 'is', 'or', 'order', 'limit', 'lt']) {
      query[m] = (...args: unknown[]) => {
        calls.push({ op: `${op}.${m}`, args });
        return query;
      };
    }
    return query;
  };
  const db = {
    from: (table: string) => ({
      delete: () => {
        calls.push({ op: 'delete', args: table });
        return chain('delete');
      },
      insert: (rows: unknown) => {
        calls.push({ op: 'insert', args: rows });
        return chain('insert');
      },
    }),
  };
  return { db: db as unknown as Parameters<typeof createNotifications>[0], calls };
}

function insertedRows<T>(calls: { op: string; args: unknown }[]): T[] {
  const insert = calls.find((c) => c.op === 'insert');
  expect(insert).toBeDefined();
  return (insert as { args: T[] }).args;
}

const input = {
  kind: 'schedule_change' as const,
  title: 'T',
  body: 'B',
  source: { type: 'shift', id: 's1' },
};

describe('createNotifications', () => {
  it('writes one row per unique lowercased recipient, minus the actor', async () => {
    const { db, calls } = fakeDb();
    const n = await createNotifications(db, ['A@x.y', 'a@x.y', 'b@x.y', 'me@x.y', ''], {
      ...input,
      actorEmail: 'ME@x.y',
      href: '/admin/schedule',
    });
    expect(n).toBe(2);
    const rows = insertedRows<{ recipient_email: string; actor_email: string }>(calls);
    expect(rows.map((r) => r.recipient_email)).toEqual(['a@x.y', 'b@x.y']);
    expect(rows[0].actor_email).toBe('me@x.y');
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('resolves a per-recipient href', async () => {
    const { db, calls } = fakeDb();
    await createNotifications(db, ['a@x.y', 'b@x.y'], {
      ...input,
      href: (email) => (email === 'a@x.y' ? '/admin/schedule' : null),
    });
    expect(insertedRows<{ href: string | null }>(calls).map((r) => r.href)).toEqual([
      '/admin/schedule',
      null,
    ]);
  });

  it('supersedes the unread rows for the same source before inserting', async () => {
    const { db, calls } = fakeDb();
    await createNotifications(db, ['a@x.y'], { ...input, supersede: true });
    expect(calls.map((c) => c.op).filter((op) => op === 'delete' || op === 'insert')).toEqual([
      'delete',
      'insert',
    ]);
  });

  it('writes nothing when nobody is left, and swallows storage errors', async () => {
    const empty = fakeDb();
    expect(
      await createNotifications(empty.db, ['me@x.y'], { ...input, actorEmail: 'me@x.y' })
    ).toBe(0);
    expect(empty.calls).toEqual([]);
    const failing = fakeDb({ failInsert: true });
    expect(await createNotifications(failing.db, ['a@x.y'], input)).toBe(0);
  });
});
