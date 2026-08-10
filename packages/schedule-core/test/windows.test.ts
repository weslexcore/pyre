// Window derivation + sync planning drive what the Momence sync writes to the
// shifts table, so the merge/pad/round rules and every divergence class
// (moved, cancelled-with-assignments, cancelled-clean, locked) get pinned.

import { describe, expect, it } from 'vitest';
import {
  type CoverageEvent,
  DEFAULT_WINDOW_OPTIONS,
  deriveCoverageWindows,
  formatShiftNotes,
  labelForWindow,
  planShiftSync,
  type SyncShiftInput,
} from '../src/windows';
import { timeToMinutes } from '../src/availability';
import { utcToEastern } from '../src/tz';

const min = timeToMinutes;

function event(partial: Partial<CoverageEvent> & { startMin: number; endMin: number }): CoverageEvent {
  return {
    kind: 'session',
    id: 1,
    title: 'Social Sauna',
    date: '2026-08-12',
    ...partial,
  };
}

describe('utcToEastern', () => {
  it('converts summer (EDT, UTC-4) timestamps', () => {
    expect(utcToEastern('2026-08-12T20:00:00Z')).toEqual({ date: '2026-08-12', minutes: min('16:00') });
  });

  it('converts winter (EST, UTC-5) timestamps', () => {
    expect(utcToEastern('2026-01-15T20:00:00Z')).toEqual({ date: '2026-01-15', minutes: min('15:00') });
  });

  it('rolls the calendar date back across midnight UTC', () => {
    // 01:30 UTC = 21:30 ET the previous day (summer)
    expect(utcToEastern('2026-08-13T01:30:00Z')).toEqual({ date: '2026-08-12', minutes: min('21:30') });
  });
});

describe('deriveCoverageWindows', () => {
  it('pads a single session by 1.5h setup / 30min shutdown and rounds to :30', () => {
    // 16:00–17:15 session → 14:30 setup lead, 17:45 close → ceil to 18:00
    const [w] = deriveCoverageWindows([event({ startMin: min('16:00'), endMin: min('17:15') })]);
    expect(w.startMin).toBe(min('14:30'));
    expect(w.endMin).toBe(min('18:00'));
    expect(w.label).toBe('Evening');
  });

  it('merges back-to-back sessions into one window', () => {
    // Classic evening: 16:00 and 18:30 sessions → one 14:30–20:30 shift
    const windows = deriveCoverageWindows([
      event({ id: 1, startMin: min('16:00'), endMin: min('17:00') }),
      event({ id: 2, startMin: min('18:30'), endMin: min('20:00') }),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0].startMin).toBe(min('14:30'));
    expect(windows[0].endMin).toBe(min('20:30'));
    expect(windows[0].sessionRefs).toHaveLength(2);
  });

  it('drops duplicate events (same kind + id) instead of double-counting', () => {
    const windows = deriveCoverageWindows([
      event({ id: 1, startMin: min('16:00'), endMin: min('17:00') }),
      event({ id: 1, startMin: min('16:00'), endMin: min('17:00') }),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0].sessionRefs).toEqual([{ type: 'session', id: 1 }]);
  });

  it('splits sessions separated by more than the merge gap', () => {
    // Morning 6:30 class vs evening 16:00 class → two windows (like 8/13's sheet rows)
    const windows = deriveCoverageWindows([
      event({ id: 1, startMin: min('06:30'), endMin: min('09:30') }),
      event({ id: 2, startMin: min('16:00'), endMin: min('20:00') }),
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0].label).toBe('Morning');
    expect(windows[1].label).toBe('Evening');
  });

  it('never merges across dates and clamps padding at midnight', () => {
    const windows = deriveCoverageWindows([
      event({ id: 1, date: '2026-08-12', startMin: min('23:00'), endMin: min('23:45') }),
      event({ id: 2, date: '2026-08-13', startMin: min('00:15'), endMin: min('01:00') }),
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0].endMin).toBe(24 * 60);
    expect(windows[1].startMin).toBe(0);
  });

  it('lists each session type once, however many slots of it the window holds', () => {
    const windows = deriveCoverageWindows([
      event({ id: 1, title: 'Open Hours', startMin: min('12:00'), endMin: min('13:00') }),
      event({ id: 2, title: 'Open Hours', startMin: min('13:00'), endMin: min('14:00') }),
      event({ id: 3, title: 'Yoga', startMin: min('14:00'), endMin: min('15:00') }),
      event({ id: 4, title: 'Open Hours', startMin: min('15:00'), endMin: min('16:00') }),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0].titles).toEqual(['Open Hours', 'Yoga']);
    expect(windows[0].sessionRefs).toHaveLength(4);
  });

  it('interleaves appointments with sessions in the same window', () => {
    const windows = deriveCoverageWindows([
      event({ id: 1, startMin: min('16:00'), endMin: min('17:00') }),
      event({ kind: 'appointment', id: 9, title: 'Private event', startMin: min('17:30'), endMin: min('19:00') }),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0].sessionRefs).toEqual([
      { type: 'session', id: 1 },
      { type: 'appointment', id: 9 },
    ]);
  });
});

describe('formatShiftNotes', () => {
  it('collapses repeated session titles on momence shifts', () => {
    expect(
      formatShiftNotes({
        source: 'momence',
        notes: 'Open Hours, Open Hours, Yoga, Open Hours',
      })
    ).toBe('Open Hours, Yoga');
  });

  it('leaves manual notes and empty notes alone', () => {
    expect(formatShiftNotes({ source: 'manual', notes: 'Deep clean, deep clean' })).toBe(
      'Deep clean, deep clean'
    );
    expect(formatShiftNotes({ source: 'momence', notes: null })).toBeNull();
  });
});

describe('labelForWindow', () => {
  it('labels like the sheet', () => {
    expect(labelForWindow(min('05:30'), min('10:30'))).toBe('Morning');
    expect(labelForWindow(min('08:30'), min('16:30'))).toBe('Day');
    expect(labelForWindow(min('11:30'), min('16:30'))).toBe('Afternoon');
    expect(labelForWindow(min('14:30'), min('20:30'))).toBe('Evening');
  });
});

describe('planShiftSync', () => {
  const window = (over: Partial<ReturnType<typeof deriveCoverageWindows>[number]> = {}) => ({
    date: '2026-08-12',
    startMin: min('15:00'),
    endMin: min('20:30'),
    label: 'Evening',
    staffNeeded: 2,
    sessionRefs: [{ type: 'session' as const, id: 1 }],
    titles: ['Social Sauna'],
    ...over,
  });

  const shift = (over: Partial<SyncShiftInput> = {}): SyncShiftInput => ({
    id: 'shift-1',
    shift_date: '2026-08-12',
    starts_at: '15:00:00',
    ends_at: '20:30:00',
    source: 'momence',
    momence_session_ids: [{ type: 'session', id: 1 }],
    sync_locked: false,
    status: 'active',
    sync_flag: null,
    is_draft: false,
    assignmentCount: 0,
    ...over,
  });

  it('creates windows with no matching shift', () => {
    const plan = planShiftSync([window()], []);
    expect(plan.create).toHaveLength(1);
  });

  it('no-ops when times and refs match, clearing stale flags', () => {
    const plan = planShiftSync([window()], [shift({ sync_flag: 'times_changed' })]);
    expect(plan).toMatchObject({ create: [], update: [], cancel: [], flag: [] });
    expect(plan.clearFlag).toEqual(['shift-1']);
  });

  it('updates an unlocked shift whose session times moved', () => {
    const plan = planShiftSync([window({ startMin: min('14:30') })], [shift()]);
    expect(plan.update).toEqual([
      {
        shiftId: 'shift-1',
        startsAt: '14:30',
        endsAt: '20:30',
        sessionRefs: [{ type: 'session', id: 1 }],
      },
    ]);
  });

  it('flags instead of updating when the shift is sync_locked', () => {
    const plan = planShiftSync([window({ startMin: min('14:30') })], [shift({ sync_locked: true })]);
    expect(plan.update).toHaveLength(0);
    expect(plan.flag).toEqual([{ shiftId: 'shift-1', flag: 'times_changed' }]);
  });

  it('auto-cancels an unassigned shift whose sessions disappeared', () => {
    const plan = planShiftSync([], [shift()]);
    expect(plan.cancel).toEqual([{ shiftId: 'shift-1', reason: 'Momence sessions removed' }]);
  });

  it('flags (never cancels) a staffed shift whose sessions disappeared', () => {
    const plan = planShiftSync([], [shift({ assignmentCount: 2 })]);
    expect(plan.cancel).toHaveLength(0);
    expect(plan.flag).toEqual([{ shiftId: 'shift-1', flag: 'sessions_cancelled' }]);
  });

  it('delete-and-replace nets one flagged staffed shift plus one new window', () => {
    // Evening session deleted, morning session added instead: the staffed
    // evening shift gets flagged, the morning window is created fresh.
    const morningReplacement = window({
      sessionRefs: [{ type: 'session', id: 2 }],
      startMin: min('08:00'),
      endMin: min('12:00'),
      label: 'Morning',
    });
    const plan = planShiftSync([morningReplacement], [shift({ assignmentCount: 1 })]);
    expect(plan.create).toHaveLength(1);
    expect(plan.flag).toEqual([{ shiftId: 'shift-1', flag: 'sessions_cancelled' }]);
  });

  it('does not duplicate a window an active manual shift already covers', () => {
    // e.g. sheet-imported or admin-entered shift over the same session/time
    const plan = planShiftSync(
      [window()],
      [shift({ id: 'manual-1', source: 'manual', momence_session_ids: [] })]
    );
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it('still creates the window when the overlapping manual shift is cancelled', () => {
    const plan = planShiftSync(
      [window()],
      [shift({ id: 'manual-1', source: 'manual', momence_session_ids: [], status: 'cancelled' })]
    );
    expect(plan.create).toHaveLength(1);
  });

  it('ignores manual, draft, and already-cancelled shifts', () => {
    const plan = planShiftSync(
      [],
      [
        shift({ id: 'manual', source: 'manual' }),
        shift({ id: 'draft', is_draft: true }),
        shift({ id: 'gone', status: 'cancelled' }),
      ]
    );
    expect(plan).toEqual({ create: [], update: [], cancel: [], flag: [], clearFlag: [] });
  });
});
