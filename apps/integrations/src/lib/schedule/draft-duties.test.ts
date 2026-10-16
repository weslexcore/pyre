// What the scheduler agent may hand out of the week's off-shift duties.

import {
  DEFAULT_DUTY_CATALOG,
  type DutyDef,
  type StaffRow,
  type TimeOffRow,
  trainingFromRows,
} from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import { checkDraftDuties } from './draft-duties';

const carboys: DutyDef = {
  key: 'fill_carboys',
  label: 'Fill Carboys',
  detail: null,
  phase: 'off_shift',
  side: null,
  sessionDefault: null,
  sopSlug: null,
  days: [1],
  sortOrder: 10,
  requiresTraining: true,
  archived: false,
};

const staffById = new Map<string, StaffRow>([
  ['sunny', { id: 'sunny', display_name: 'Sunny', active: true } as StaffRow],
  ['julien', { id: 'julien', display_name: 'Julien', active: true } as StaffRow],
  ['gone', { id: 'gone', display_name: 'Gone', active: false } as StaffRow],
]);

const ctx = (over: Partial<Parameters<typeof checkDraftDuties>[1]> = {}) => ({
  catalog: [...DEFAULT_DUTY_CATALOG, carboys],
  training: trainingFromRows([{ staff_id: 'sunny', duty_key: 'fill_carboys' }]),
  staffById,
  timeOff: [] as TimeOffRow[],
  // 2026-10-19 is a Monday.
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  taken: new Set<string>(),
  ...over,
});

const monday = { dutyKey: 'fill_carboys', date: '2026-10-19', staffId: 'sunny' };

describe('checkDraftDuties', () => {
  it('accepts an open day for someone who can do it', () => {
    expect(checkDraftDuties([monday], ctx())).toEqual({ ok: true, duties: [monday] });
  });

  it('rejects malformed entries outright', () => {
    expect(checkDraftDuties([{ ...monday, dutyKey: 'host' }], ctx())).toMatchObject({
      error: expect.stringContaining('not a live off-shift duty'),
    });
    expect(checkDraftDuties([{ ...monday, date: '2026-10-20' }], ctx())).toMatchObject({
      error: expect.stringContaining("isn't done on"),
    });
    expect(checkDraftDuties([{ ...monday, date: '2026-10-26' }], ctx())).toMatchObject({
      error: expect.stringContaining('in the week'),
    });
    expect(checkDraftDuties([{ ...monday, staffId: 'gone' }], ctx())).toMatchObject({
      error: expect.stringContaining('inactive'),
    });
    expect(checkDraftDuties([monday, monday], ctx())).toMatchObject({
      error: expect.stringContaining('given twice'),
    });
  });

  it('lists every day that can not be given as drafted', () => {
    const result = checkDraftDuties(
      [{ ...monday, staffId: 'julien' }],
      ctx({ taken: new Set(['fill_carboys:2026-10-19']) })
    );
    expect(result).toEqual({
      ok: false,
      problems: [
        'Fill Carboys on 2026-10-19 is already assigned',
        "Julien can't do Fill Carboys (not in its trainedStaffIds)",
      ],
    });
  });

  it('keeps anyone off the whole day off it', () => {
    const timeOff: TimeOffRow[] = [
      {
        id: 't-1',
        staff_id: 'sunny',
        kind: 'range',
        start_date: '2026-10-19',
        end_date: '2026-10-19',
        days_of_week: [],
        starts_at: null,
        ends_at: null,
        note: null,
        is_emergency: false,
        created_by: 'staff',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    ];
    expect(checkDraftDuties([monday], ctx({ timeOff }))).toMatchObject({
      problems: ['Sunny is off all day 2026-10-19'],
    });
  });
});
