// The classifier triages a note only while no admin has: actionable signals
// put it on the to-do list, none resolve it, and every move is recorded.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { triageFromClassification, triageStatus } from './triage';

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;

/** Just enough of the supabase builder for triage: one note, and inserted activity. */
function fakeDb(note: Row) {
  const inserted: Row[] = [];
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    let insert: Row | null = null;
    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return api;
      },
      is: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return api;
      },
      update: (value: Row) => {
        patch = value;
        return api;
      },
      insert: (value: Row) => {
        insert = value;
        return api;
      },
      single: async () => api.maybeSingle(),
      maybeSingle: async () => {
        if (insert) {
          inserted.push({ table, ...insert });
          return { data: insert, error: null };
        }
        const hit = table === 'shift_notes' && filters.every((f) => f(note)) ? note : null;
        if (hit && patch) Object.assign(hit, patch);
        // A copy, as the real client returns: later updates don't reach it.
        return { data: hit ? { ...hit } : null, error: null };
      },
    };
    return api;
  }
  return { db: { from } as never, note, inserted };
}

const untriaged = (status = 'open'): Row => ({ id: NOTE_ID, status, status_by: null });

describe('triageStatus', () => {
  it('puts anything actionable on the to-do list and resolves the rest', () => {
    expect(triageStatus([{ type: 'action', probability: 0.9 }])).toBe('todo');
    expect(triageStatus([{ type: 'safety', probability: 0.4 }])).toBe('todo');
    expect(triageStatus([{ type: 'feedback', probability: 0.8 }])).toBe('resolved');
    expect(triageStatus([])).toBe('resolved');
  });
});

describe('triageFromClassification', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('moves an untriaged note and records the move for admins', async () => {
    const { db, note, inserted } = fakeDb(untriaged());
    const moved = await triageFromClassification(db, NOTE_ID, [
      { type: 'question', probability: 0.7 },
    ]);
    expect(moved).toBe('todo');
    expect(note.status).toBe('todo');
    expect(note.status_by).toBeNull();
    expect(inserted).toEqual([
      {
        table: 'shift_note_replies',
        note_id: NOTE_ID,
        kind: 'status',
        author_email: null,
        is_private: true,
        body: '',
        data: { from: 'open', to: 'todo', source: 'classifier' },
      },
    ]);
  });

  it('resolves a purely informational note', async () => {
    const { db, note } = fakeDb(untriaged());
    expect(await triageFromClassification(db, NOTE_ID, [])).toBe('resolved');
    expect(note.status).toBe('resolved');
  });

  it('re-triages its own call when the note is read again', async () => {
    const { db, note } = fakeDb(untriaged('resolved'));
    expect(
      await triageFromClassification(db, NOTE_ID, [{ type: 'action', probability: 0.9 }])
    ).toBe('todo');
    expect(note.status).toBe('todo');
  });

  it("never overrides an admin's status", async () => {
    const { db, note, inserted } = fakeDb({
      id: NOTE_ID,
      status: 'resolved',
      status_by: 'wes@pyresauna.com',
    });
    expect(
      await triageFromClassification(db, NOTE_ID, [{ type: 'action', probability: 0.9 }])
    ).toBeNull();
    expect(note.status).toBe('resolved');
    expect(inserted).toEqual([]);
  });

  it('records nothing when the status already matches', async () => {
    const { db, inserted } = fakeDb(untriaged('todo'));
    expect(
      await triageFromClassification(db, NOTE_ID, [{ type: 'action', probability: 0.9 }])
    ).toBeNull();
    expect(inserted).toEqual([]);
  });
});
