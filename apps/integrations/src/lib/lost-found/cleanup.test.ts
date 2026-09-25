import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { runLostFoundCleanup } from './cleanup';

vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

type Row = Record<string, string | null>;
const ctx = { dryRun: false, timeRemainingMs: () => 10_000 };

function fixture() {
  const items: Row[] = [];
  const attachments: Row[] = [];
  const operations: string[] = [];
  const remove = vi.fn(async (_paths: string[]) => {
    operations.push('storage');
    return { error: null as null | { message: string } };
  });
  let attachmentError = false;
  let deleteError = false;
  let reopened = false;
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let deleting = false;
    let single = false;
    let limit = Infinity;
    let order = '';
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {
        filters.push((row) => row[key] === value);
        return query;
      },
      lte: (key: string, value: string) => {
        filters.push((row) => row[key] != null && row[key] <= value);
        return query;
      },
      order: (key: string) => {
        order = key;
        return query;
      },
      limit: (value: number) => {
        limit = value;
        return query;
      },
      maybeSingle: () => {
        single = true;
        return query;
      },
      delete: () => {
        deleting = true;
        return query;
      },
      // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally thenable.
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === 'lost_found_items' ? items : attachments;
        const matches = rows
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => String(a[order]).localeCompare(String(b[order])))
          .slice(0, limit);
        if ((table === 'lost_found_attachments' && attachmentError) || (deleting && deleteError)) {
          return Promise.resolve(resolve({ data: null, error: { message: 'failure' } }));
        }
        if (deleting) {
          operations.push('database');
          for (const row of matches) rows.splice(rows.indexOf(row), 1);
        }
        return Promise.resolve(
          resolve({
            data: single ? (reopened ? null : (matches[0] ?? null)) : matches,
            error: null,
          })
        );
      },
    };
    return query;
  };
  vi.mocked(getDb).mockReturnValue({
    from,
    storage: { from: () => ({ remove }) },
  } as unknown as NonNullable<ReturnType<typeof getDb>>);
  const add = (
    id: string,
    status = 'picked_up',
    date: string | null = '2026-08-26T12:00:00.000Z'
  ) => {
    items.push({
      id,
      status,
      picked_up_at: date,
      donated_at: date,
      updated_at: '2026-08-26T12:00:00.000Z',
    });
    attachments.push({ item_id: id, storage_path: `lost-found/${id}/photo.jpg` });
  };
  return {
    items,
    add,
    remove,
    operations,
    failAttachments: () => {
      attachmentError = true;
    },
    failDelete: () => {
      deleteError = true;
    },
    reopen: () => {
      reopened = true;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T12:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('lost-found retention', () => {
  it('deletes only pickups and donations at least 30 days old, storage first', async () => {
    const f = fixture();
    f.add('pickup');
    f.add('donation', 'donated');
    f.add('recent', 'picked_up', '2026-08-26T12:00:00.001Z');
    f.add('missing-date', 'donated', null);
    for (const status of ['unclaimed', 'claimed', 'claim_pending', 'due_for_donation', 'discarded'])
      f.add(status, status);
    expect(await runLostFoundCleanup(ctx)).toMatchObject({ checked: 2, deleted: 2, failed: 0 });
    expect(f.items.map((item) => item.id)).not.toContain('pickup');
    expect(f.items).toHaveLength(7);
    expect(f.operations).toEqual(['storage', 'database', 'storage', 'database']);
    expect(f.remove).toHaveBeenCalledWith(['lost-found/donation/photo.jpg']);
    expect((await runLostFoundCleanup(ctx)).deleted).toBe(0);
  });

  it('reports candidates without writes in a dry run', async () => {
    const f = fixture();
    f.add('pickup');
    expect(await runLostFoundCleanup({ ...ctx, dryRun: true })).toMatchObject({
      checked: 1,
      deleted: 0,
    });
    expect(f.operations).toEqual([]);
  });

  it.each(['attachments', 'storage', 'database'])(
    'retains records for retry after a %s failure',
    async (failure) => {
      const f = fixture();
      f.add('pickup');
      if (failure === 'attachments') f.failAttachments();
      if (failure === 'storage') f.remove.mockResolvedValue({ error: { message: 'unavailable' } });
      if (failure === 'database') f.failDelete();
      expect(await runLostFoundCleanup(ctx)).toMatchObject({ deleted: 0, failed: 1 });
      expect(f.items).toHaveLength(1);
      if (failure !== 'database') expect(f.operations).not.toContain('database');
    }
  );

  it('skips items changed since selection', async () => {
    const f = fixture();
    f.add('pickup');
    f.reopen();
    expect((await runLostFoundCleanup(ctx)).deleted).toBe(0);
    expect(f.operations).toEqual([]);
  });

  it('stops when the shared cron budget is exhausted', async () => {
    const f = fixture();
    f.add('pickup');
    expect((await runLostFoundCleanup({ ...ctx, timeRemainingMs: () => 0 })).deleted).toBe(0);
    expect(f.operations).toEqual([]);
  });
});
