// The duty list editor's rules: what an admin may add or change without
// leaving the A/B pairing ambiguous or a half pointing at a duty that can't
// be its in-session default.

import { DEFAULT_DUTY_CATALOG as C, type ShiftDutyRow } from '@pyre/schedule-core';
import { describe, expect, it } from 'vitest';
import {
  keyFromLabel,
  normalizeDutyCreate,
  normalizeDutyOrder,
  normalizeDutyPatch,
} from './duty-validate';

const row = (key: string): ShiftDutyRow => {
  const d = C.find((duty) => duty.key === key);
  if (!d) throw new Error(key);
  return {
    key: d.key,
    label: d.label,
    detail: d.detail,
    phase: d.phase,
    side: d.side,
    session_default: d.sessionDefault,
    sop_id: null,
    sort_order: d.sortOrder,
    archived: d.archived,
  };
};

const SOP_ID = '6f1c2e0a-8f4b-4d7e-9a53-0b7c1d2e3f40';

describe('keyFromLabel', () => {
  it('slugs the label, and suffixes it when the key is taken', () => {
    expect(keyFromLabel('Opening Checks', new Set())).toBe('opening_checks');
    expect(keyFromLabel('Host', new Set(['host']))).toBe('host_2');
    expect(keyFromLabel('Host', new Set(['host', 'host_2']))).toBe('host_3');
  });

  it('always produces a valid key, whatever the label', () => {
    expect(keyFromLabel('2nd Sweep', new Set())).toBe('duty_2nd_sweep');
    expect(keyFromLabel('!!', new Set())).toBe('duty');
  });
});

describe('normalizeDutyCreate', () => {
  it('adds a session duty linked to an SOP', () => {
    expect(
      normalizeDutyCreate(
        { label: ' Opening Checks ', phase: 'session', sopId: SOP_ID, detail: '' },
        C
      )
    ).toEqual({
      ok: true,
      value: {
        key: 'opening_checks',
        label: 'Opening Checks',
        detail: null,
        phase: 'session',
        side: null,
        session_default: null,
        sop_id: SOP_ID,
        archived: false,
      },
    });
  });

  it('requires a label and a phase', () => {
    expect(normalizeDutyCreate({ phase: 'session' }, C)).toEqual({
      ok: false,
      error: 'label is required',
    });
    expect(normalizeDutyCreate({ label: 'X' }, C)).toEqual({
      ok: false,
      error: 'phase is required',
    });
    expect(normalizeDutyCreate({ label: 'X', phase: 'lunch' }, C).ok).toBe(false);
  });

  it('refuses a second live duty on a side that is already taken', () => {
    const result = normalizeDutyCreate({ label: 'Laundry', phase: 'breakdown', side: 'a' }, C);
    expect(result).toEqual({
      ok: false,
      error:
        'Break Down (A) is already the A side of Breakdown. Archive it or pick the other side.',
    });
  });

  it('allows a side once the old holder is archived', () => {
    const archived = C.map((d) => (d.key === 'breakdown_a' ? { ...d, archived: true } : d));
    expect(
      normalizeDutyCreate(
        { label: 'Laundry', phase: 'breakdown', side: 'a', sessionDefault: 'customer_care' },
        archived
      ).ok
    ).toBe(true);
  });

  it('adds any number of unsplit duties alongside the A/B halves of a phase', () => {
    const result = normalizeDutyCreate({ label: 'Plunge Care', phase: 'setup' }, C);
    expect(result).toMatchObject({ ok: true, value: { key: 'plunge_care', side: null } });
  });

  it('keeps sides and in-session defaults to the set-up and break-down phases', () => {
    expect(normalizeDutyCreate({ label: 'X', phase: 'session', side: 'a' }, C)).toMatchObject({
      ok: false,
    });
    expect(
      normalizeDutyCreate({ label: 'X', phase: 'session', sessionDefault: 'host' }, C)
    ).toMatchObject({ ok: false });
  });

  it('checks the in-session default is a live session duty', () => {
    expect(
      normalizeDutyCreate({ label: 'X', phase: 'setup', sessionDefault: 'setup_b' }, C)
    ).toMatchObject({ ok: false });
    expect(
      normalizeDutyCreate({ label: 'X', phase: 'setup', sessionDefault: 'nope' }, C)
    ).toMatchObject({ ok: false });
  });
});

describe('normalizeDutyPatch', () => {
  it('returns only what changed', () => {
    expect(normalizeDutyPatch({ label: 'Front of House', detail: null }, row('host'), C)).toEqual({
      ok: true,
      value: { label: 'Front of House' },
    });
  });

  it('says so when nothing changed', () => {
    expect(normalizeDutyPatch({ label: 'Host' }, row('host'), C)).toEqual({
      ok: false,
      error: 'No changes',
    });
  });

  it('archives and restores', () => {
    expect(normalizeDutyPatch({ archived: true }, row('setup_a'), C)).toEqual({
      ok: true,
      value: { archived: true },
    });
  });

  it('will not restore a half onto a side something else now holds', () => {
    const catalog = [
      ...C.map((d) => (d.key === 'setup_a' ? { ...d, archived: true } : d)),
      { ...C[0], key: 'setup_new', label: 'New Set Up (A)' },
    ];
    const archivedRow = { ...row('setup_a'), archived: true };
    expect(normalizeDutyPatch({ archived: false }, archivedRow, catalog)).toMatchObject({
      ok: false,
    });
  });

  it('keeps a session duty in session while a half defaults to it', () => {
    expect(normalizeDutyPatch({ phase: 'setup' }, row('host'), C)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Set Up (B) defaults to this duty'),
    });
  });

  it('drops the side and default when a half moves into the session', () => {
    const catalog = C.filter((d) => d.key !== 'breakdown_b');
    expect(normalizeDutyPatch({ phase: 'session' }, row('setup_b'), catalog)).toEqual({
      ok: true,
      value: { phase: 'session', side: null, session_default: null },
    });
  });

  it('rejects a malformed SOP id', () => {
    expect(normalizeDutyPatch({ sopId: 'set-up' }, row('host'), C)).toMatchObject({ ok: false });
  });
});

describe('normalizeDutyOrder', () => {
  it('keeps any duty the client left out, in its old place', () => {
    expect(normalizeDutyOrder(['c', 'a', 'zzz'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });

  it('rejects anything but a list of keys', () => {
    expect(normalizeDutyOrder('a,b', ['a'])).toBeNull();
    expect(normalizeDutyOrder([1], ['a'])).toBeNull();
  });
});
