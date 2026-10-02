import { describe, expect, it } from 'vitest';
import type { ChecklistAnswer } from '@/lib/db';
import {
  checklistDestination,
  checklistDone,
  checklistOf,
  checklistPeople,
  editChecklist,
  formatChecklist,
  normalizeChecklist,
  stampChecklists,
  toggleChecklist,
  withoutChecklists,
} from './checklist';

const MD = '## Onboarding\n\n- [ ] Contract signed\n- [!] W-9 received\n- [ ] Intro call';

const FIELD = {
  key: 'onboarding',
  kind: 'checklist' as const,
  checklist_md: MD,
  checklist_done_column: 'active',
  archived: false,
};

const COLUMNS = [
  { id: 'col-new', key: 'new', archived: false },
  { id: 'col-active', key: 'active', archived: false },
];

function answer(checks: [number, string, boolean?][], md = MD): ChecklistAnswer {
  return {
    md,
    checks: checks.map(([i, t, s]) => ({
      i,
      t,
      s: s === true,
      by: 'a@pyre.co',
      at: '2026-10-01T12:00:00Z',
    })),
  };
}

const ALL_DONE = answer([
  [0, 'Contract signed'],
  [1, 'W-9 received'],
  [2, 'Intro call', true],
]);

describe('checklistOf', () => {
  it('reads the field default until the card has its own answer', () => {
    expect(checklistOf(FIELD, undefined)).toEqual({ md: MD, checks: [] });
    expect(checklistOf(FIELD, ALL_DONE)).toBe(ALL_DONE);
  });
});

describe('normalizeChecklist', () => {
  it('keeps only checks that name an item by index and text, once each', () => {
    const result = normalizeChecklist({
      md: MD,
      checks: [
        { i: 0, t: 'Contract signed', s: false, by: 'x', at: 'y' },
        { i: 0, t: 'Contract signed', s: true },
        { i: 2, t: 'Something else', s: false },
        { i: 9, t: 'Intro call', s: false },
        { i: 'one', t: 'Contract signed' },
      ],
    });
    expect(result?.checks.map((check) => check.i)).toEqual([0]);
  });

  it('refuses a skip on a required item by leaving it open', () => {
    const result = normalizeChecklist({ md: MD, checks: [{ i: 1, t: 'W-9 received', s: true }] });
    expect(result?.checks).toEqual([]);
  });

  it('clears an empty or malformed answer', () => {
    expect(normalizeChecklist({ md: '   ', checks: [] })).toBeNull();
    expect(normalizeChecklist('- [ ] text')).toBeNull();
    expect(normalizeChecklist(['x'])).toBeNull();
  });
});

describe('toggleChecklist and checklistDone', () => {
  it('resolves and un-resolves items, finishing once all are accounted for', () => {
    let current = checklistOf(FIELD, undefined);
    current = toggleChecklist(
      current,
      [
        { itemIndex: 0, itemText: 'Contract signed' },
        { itemIndex: 1, itemText: 'W-9 received' },
      ],
      true,
      'me@pyre.co',
      'now'
    );
    expect(checklistDone(current)).toBe(false);
    current = toggleChecklist(
      current,
      [{ itemIndex: 2, itemText: 'Intro call', skipped: true }],
      true,
      'me@pyre.co',
      'now'
    );
    expect(checklistDone(current)).toBe(true);
    current = toggleChecklist(
      current,
      [{ itemIndex: 1, itemText: 'W-9 received' }],
      false,
      'me@pyre.co',
      'now'
    );
    expect(current.checks.map((check) => check.i)).toEqual([0, 2]);
    expect(checklistDone(current)).toBe(false);
  });
});

describe('editChecklist', () => {
  it('moves marks with their words and drops the ones whose item is gone', () => {
    const edited = editChecklist(
      answer([
        [0, 'Contract signed'],
        [2, 'Intro call'],
      ]),
      '- [ ] Deposit paid\n- [ ] Contract signed\n- [ ] Intro call booked'
    );
    expect(edited.checks.map((check) => [check.i, check.t])).toEqual([[1, 'Contract signed']]);
  });
});

describe('stampChecklists', () => {
  it('keeps the stamp on marks that did not change and stamps the new ones', () => {
    const before = { onboarding: answer([[0, 'Contract signed']]) };
    const after = {
      onboarding: {
        md: MD,
        checks: [
          { i: 0, t: 'Contract signed', s: false, by: 'forged@x.co', at: 'then' },
          { i: 1, t: 'W-9 received', s: false, by: 'forged@x.co', at: 'then' },
        ],
      },
    };
    const stamped = stampChecklists([FIELD], before, after, 'me@pyre.co', 'now')
      .onboarding as ChecklistAnswer;
    expect(stamped.checks).toEqual([
      { i: 0, t: 'Contract signed', s: false, by: 'a@pyre.co', at: '2026-10-01T12:00:00Z' },
      { i: 1, t: 'W-9 received', s: false, by: 'me@pyre.co', at: 'now' },
    ]);
  });
});

describe('checklistDestination', () => {
  it('moves the card the save its checklist is finished on', () => {
    expect(
      checklistDestination([FIELD], COLUMNS, 'col-new', {}, { onboarding: ALL_DONE })?.id
    ).toBe('col-active');
  });

  it('does nothing when it was already finished, or the card is already there', () => {
    expect(
      checklistDestination(
        [FIELD],
        COLUMNS,
        'col-new',
        { onboarding: ALL_DONE },
        { onboarding: ALL_DONE }
      )
    ).toBeNull();
    expect(
      checklistDestination([FIELD], COLUMNS, 'col-active', {}, { onboarding: ALL_DONE })
    ).toBeNull();
  });

  it('does nothing for an unfinished list, no column, or a column that is gone', () => {
    const half = answer([[0, 'Contract signed']]);
    expect(checklistDestination([FIELD], COLUMNS, 'col-new', {}, { onboarding: half })).toBeNull();
    expect(
      checklistDestination(
        [{ ...FIELD, checklist_done_column: null }],
        COLUMNS,
        'col-new',
        {},
        { onboarding: ALL_DONE }
      )
    ).toBeNull();
    expect(
      checklistDestination(
        [FIELD],
        [COLUMNS[0], { ...COLUMNS[1], archived: true }],
        'col-new',
        {},
        { onboarding: ALL_DONE }
      )
    ).toBeNull();
  });

  it('ignores a save that does not mention the field', () => {
    expect(checklistDestination([FIELD], COLUMNS, 'col-new', {}, {})).toBeNull();
  });
});

describe('the small helpers', () => {
  it('formats progress for a card row', () => {
    expect(formatChecklist(answer([[0, 'Contract signed']]))).toBe('1 of 3');
    expect(formatChecklist(ALL_DONE)).toBe('3 of 3 ✓');
    expect(formatChecklist('nope')).toBe('');
  });

  it('drops checklist answers for outside writers', () => {
    expect(withoutChecklists([FIELD], { onboarding: ALL_DONE, other: 'x' })).toEqual({
      other: 'x',
    });
  });

  it('lists the people who ticked items', () => {
    expect(checklistPeople([FIELD], [{ properties: { onboarding: ALL_DONE } }])).toEqual([
      'a@pyre.co',
    ]);
  });
});
