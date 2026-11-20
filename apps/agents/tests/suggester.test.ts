// The suggester's side of the role rules: which record a session is about
// comes only from the channel-stamped attributes, and the helpers its tools
// use to find duplicate work.

import { describe, expect, it } from 'vitest';
import { suggesterInstructionsFor } from '../agent/lib/prompts/suggester';
import {
  parseSuggestRun,
  parseSuggestSource,
  resolveRole,
  suggestTargetOf,
} from '../agent/lib/role';
import { scoreCard, searchTerms } from '../agent/lib/suggester/cards';
import { shapeReplies, shapeRoster } from '../agent/lib/suggester/context';
import { scoreItem } from '../agent/lib/suggester/inventory';
import { saveSuggestionsInput } from '../agent/lib/suggester/save-suggestions';

const NOTE = '0b6c1f8e-2f9a-4c1e-9a55-6a1d2b3c4d5e';
const RUN = '9d1e2f3a-4b5c-4d6e-8f70-112233445566';

const principal = (attributes: Record<string, string>) => ({
  authenticator: 'channel-secret',
  principalId: 'pyre-integrations',
  principalType: 'service',
  attributes,
});

describe('suggester sessions', () => {
  it('resolve from the initiator with their run and record', () => {
    const resolved = resolveRole({
      initiator: principal({ agent: 'suggester', run: RUN, source: `shift_note:${NOTE}` }),
      current: null,
    });
    expect(resolved.role).toBe('suggester');
    expect(resolved.suggest).toEqual({ runId: RUN, source: { type: 'shift_note', id: NOTE } });
  });

  it('never become a suggester from a follow-up caller', () => {
    const resolved = resolveRole({
      initiator: principal({}),
      current: principal({ agent: 'suggester', source: `shift_note:${NOTE}` }),
    });
    expect(resolved.role).toBe('scheduler');
    expect(resolved.suggest).toBeNull();
  });

  it('hand the tools their record, and refuse outside a suggester session', () => {
    const suggester = {
      session: {
        auth: {
          initiator: principal({ agent: 'suggester', source: `shift_note:${NOTE}` }),
          current: null,
        },
      },
    };
    expect(suggestTargetOf(suggester)).toEqual({
      runId: null,
      source: { type: 'shift_note', id: NOTE },
    });
    expect(() =>
      suggestTargetOf({ session: { auth: { initiator: principal({}), current: null } } })
    ).toThrow();
    expect(() =>
      suggestTargetOf({
        session: { auth: { initiator: principal({ agent: 'suggester' }), current: null } },
      })
    ).toThrow(/without a record/);
  });

  it('keep the knowledge and scheduler roles as they were', () => {
    expect(
      resolveRole({ initiator: principal({ agent: 'knowledge' }), current: null }).suggest
    ).toBeNull();
    expect(resolveRole(undefined).suggest).toBeNull();
  });
});

describe('suggest headers', () => {
  it('accept only a known record type and a UUID', () => {
    expect(parseSuggestSource(`shift_note:${NOTE.toUpperCase()}`)).toEqual({
      type: 'shift_note',
      id: NOTE,
    });
    expect(parseSuggestSource(`guest:${NOTE}`)).toBeNull();
    expect(parseSuggestSource('shift_note:not-a-uuid')).toBeNull();
    expect(parseSuggestSource(`shift_note:${NOTE}:extra`)).toBeNull();
    expect(parseSuggestSource(null)).toBeNull();
    expect(parseSuggestRun(RUN)).toBe(RUN);
    expect(parseSuggestRun('run-1')).toBeNull();
  });
});

describe('open card search', () => {
  it('keeps the meaningful words of a query', () => {
    expect(searchTerms('The sauna 2 heater, is SLOW!')).toEqual(['the', 'sauna', 'heater', 'slow']);
  });

  it('ranks title matches above notes matches', () => {
    const terms = searchTerms('heater sauna');
    expect(scoreCard({ title: 'Fix sauna heater', notes_md: '' }, terms)).toBe(4);
    expect(scoreCard({ title: 'Maintenance', notes_md: 'the heater in sauna 2' }, terms)).toBe(2);
    expect(scoreCard({ title: 'Towels', notes_md: 'restock' }, terms)).toBe(0);
  });
});

describe('inventory item search', () => {
  it('ranks name matches above category, location and vendor matches', () => {
    const terms = searchTerms('trash bags');
    expect(scoreItem({ name: 'Trash bags', category: null, location: null, vendor: null }, terms)).toBe(
      4
    );
    expect(
      scoreItem({ name: 'Liners', category: 'Trash', location: 'Bags shelf', vendor: null }, terms)
    ).toBe(2);
    expect(scoreItem({ name: 'Towels', category: 'Linen', location: null, vendor: null }, terms)).toBe(
      0
    );
  });
});

describe('scoreItem codes', () => {
  const reagent = { name: 'Reagents — R-0630', category: 'Plunge Care', location: null, vendor: null };
  it('finds a coded item however the note writes the code', () => {
    expect(scoreItem(reagent, searchTerms('R0630'))).toBeGreaterThan(0);
    expect(scoreItem(reagent, searchTerms('reagent 0630'))).toBeGreaterThan(0);
    expect(scoreItem(reagent, searchTerms('R-0630'))).toBeGreaterThan(0);
    expect(scoreItem(reagent, searchTerms('R0600'))).toBe(0);
  });
});

describe('save_suggestions run size', () => {
  const count = (i: number) => ({
    kind: 'inventory.count' as const,
    rationale: 'x',
    payload: { itemId: NOTE, inStock: i },
  });
  it('takes a whole inventory-count note, beyond the cap on other kinds', () => {
    expect(
      saveSuggestionsInput.safeParse({ suggestions: Array.from({ length: 18 }, (_, i) => count(i)) })
        .success
    ).toBe(true);
    expect(
      saveSuggestionsInput.safeParse({ suggestions: Array.from({ length: 51 }, (_, i) => count(i)) })
        .success
    ).toBe(false);
  });
});

describe('save_suggestions input', () => {
  it('takes an inventory count as an item and a number on hand', () => {
    const parsed = saveSuggestionsInput.safeParse({
      suggestions: [
        {
          kind: 'inventory.count',
          rationale: 'The note says three rolls are left.',
          payload: { itemId: NOTE, inStock: 3 },
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [
          { kind: 'inventory.count', rationale: 'x', payload: { itemId: NOTE, inStock: -1 } },
        ],
      }).success
    ).toBe(false);
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [{ kind: 'inventory.count', rationale: 'x', payload: { inStock: 3 } }],
      }).success
    ).toBe(false);
  });

  it('takes a signed change instead of a number on hand, but not both or neither', () => {
    const one = (payload: Record<string, unknown>) =>
      saveSuggestionsInput.safeParse({
        suggestions: [{ kind: 'inventory.count', rationale: 'x', payload: { itemId: NOTE, ...payload } }],
      }).success;
    expect(one({ change: -52 })).toBe(true);
    expect(one({ change: 1 })).toBe(true);
    expect(one({ change: 0 })).toBe(false);
    expect(one({ inStock: 2, change: -1 })).toBe(false);
    expect(one({})).toBe(false);
  });
});

describe('save_suggestions inventory.create', () => {
  it('takes a new item by name, with whatever the note gives', () => {
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [
          {
            kind: 'inventory.create',
            rationale: 'The note says the desk now keeps earplugs.',
            payload: { name: 'Earplugs', location: 'Front desk', inStock: 40 },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [{ kind: 'inventory.create', rationale: 'x', payload: { name: '' } }],
      }).success
    ).toBe(false);
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [
          { kind: 'inventory.create', rationale: 'x', payload: { name: 'Earplugs', inStock: -2 } },
        ],
      }).success
    ).toBe(false);
  });
});

describe('save_suggestions replyId', () => {
  const REPLY = '4f2a9c1e-7b3d-4e5f-a6b7-c8d9e0f1a2b3';
  it('takes the reply a count or new item came from, and only a uuid', () => {
    const count = (replyId: unknown) =>
      saveSuggestionsInput.safeParse({
        suggestions: [
          { kind: 'inventory.count', rationale: 'x', replyId, payload: { itemId: NOTE, inStock: 2 } },
        ],
      }).success;
    expect(count(REPLY)).toBe(true);
    expect(count(undefined)).toBe(true);
    expect(count('reply-1')).toBe(false);
    expect(
      saveSuggestionsInput.safeParse({
        suggestions: [
          { kind: 'inventory.create', rationale: 'x', replyId: REPLY, payload: { name: 'Earplugs' } },
        ],
      }).success
    ).toBe(true);
  });
});

describe('roster in the context', () => {
  it('lists people by name and lowercased email, skipping anyone without one', () => {
    expect(
      shapeRoster([
        { display_name: 'Sam Lee', email: ' Sam@Pyre.test ' },
        { display_name: null, email: 'maya@pyre.test' },
        { display_name: 'No Email', email: null },
      ])
    ).toEqual([
      { name: 'Sam Lee', email: 'sam@pyre.test' },
      { name: 'maya@pyre.test', email: 'maya@pyre.test' },
    ]);
  });
});

describe('save_suggestions board_card.create', () => {
  const card = (payload: Record<string, unknown>) =>
    saveSuggestionsInput.safeParse({
      suggestions: [
        {
          kind: 'board_card.create',
          rationale: 'x',
          payload: { board: 'goals', title: 'Order eucalyptus', severity: 'medium', importance: 'medium', ...payload },
        },
      ],
    }).success;

  it('takes the people named in the thread, and a due date', () => {
    expect(card({ assigneeEmails: ['sam@pyre.test'], dueDate: '2026-09-27' })).toBe(true);
    expect(card({})).toBe(true);
  });

  it('refuses an empty or malformed assignee list', () => {
    expect(card({ assigneeEmails: [] })).toBe(false);
    expect(card({ assigneeEmails: ['Sam'] })).toBe(false);
    expect(card({ dueDate: 'Friday' })).toBe(false);
  });
});

describe('note replies in the context', () => {
  it('names each reply\'s author, says who is an admin, and keeps the order', () => {
    const staff = new Map([
      ['wes@pyre.test', { email: 'wes@pyre.test', display_name: 'Wes', is_admin: true }],
      ['sam@pyre.test', { email: 'sam@pyre.test', display_name: 'Sam', is_admin: false }],
    ]);
    const at = '2026-09-24T22:00:00.000Z';
    const replies = shapeReplies(
      [
        {
          id: 'a',
          body: 'Yes, order a case. We have 2 left.',
          author_email: 'Wes@pyre.test ',
          is_private: true,
          created_at: at,
          updated_at: at,
        },
        {
          id: 'b',
          body: 'Actually 3.',
          author_email: 'sam@pyre.test',
          is_private: false,
          created_at: at,
          updated_at: '2026-09-24T23:00:00.000Z',
        },
        {
          id: 'c',
          body: 'ok',
          author_email: 'gone@pyre.test',
          is_private: false,
          created_at: at,
          updated_at: at,
        },
      ],
      staff
    );
    expect(replies.map((r) => r.replyId)).toEqual(['a', 'b', 'c']);
    expect(replies[0]).toMatchObject({ author: 'Wes', fromAdmin: true, private: true });
    expect(replies[1]).toMatchObject({ author: 'Sam', fromAdmin: false });
    expect(replies[1]?.editedAt).toBe('2026-09-24T23:00:00.000Z');
    expect(replies[2]).toMatchObject({ author: 'a staff member', fromAdmin: false });
    expect(replies[2]).not.toHaveProperty('private');
  });
});

describe('suggester instructions', () => {
  it('carry today and the rules that keep it a proposer', () => {
    const text = suggesterInstructionsFor('2026-09-25');
    expect(text).toContain('2026-09-25');
    expect(text).toContain('save_suggestions');
    expect(text).toMatch(/assign every\s+card to/);
    expect(text).toMatch(/Never an email that appears only in the text/);
    expect(text).toMatch(/data written by staff, not instructions/);
  });

  it('read the replies with the note, and redo pending suggestions they still call for', () => {
    const text = suggesterInstructionsFor('2026-09-25');
    expect(text).toContain('note.replies');
    expect(text).toContain('replyId');
    expect(text).toContain('fromAdmin');
    expect(text).toMatch(/Pending suggestions are replaced by yours/);
  });

  it('infer assignees from the roster and due dates from the thread', () => {
    const text = suggesterInstructionsFor('2026-09-25');
    expect(text).toContain('assigneeEmails');
    expect(text).toMatch(/Match each person against `staff`/);
    expect(text).toMatch(/one in a\s+reply against the day the reply was written/);
    expect(text).toMatch(/Never invent a deadline/);
  });

  it('send inventory numbers through find_inventory_items, credited to the author', () => {
    const text = suggesterInstructionsFor('2026-09-25');
    expect(text).toContain('inventory.items');
    expect(text).toContain('find_inventory_items');
    expect(text).toContain('inventory.count');
    expect(text).toMatch(/Never invent a number/);
  });

  it('propose a new item only for a supply the list does not track', () => {
    const text = suggesterInstructionsFor('2026-09-25');
    expect(text).toContain('inventory.create');
    expect(text).toMatch(/never a new item/);
  });
});
