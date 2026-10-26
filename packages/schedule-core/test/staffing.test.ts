// Staffing rules: first enabled match wins, empty conditions match anything,
// and the fallback covers shifts no rule reaches.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAFF_NEEDED,
  describeStaffingRule,
  matchStaffingRule,
  parseStaffingRule,
  type StaffingRule,
  type StaffingTarget,
  staffNeededFor,
  staffingRuleMatches,
} from '../src/staffing';

const rule = (over: Partial<StaffingRule> = {}): StaffingRule => ({
  id: 'r',
  name: '',
  enabled: true,
  days: [],
  shiftLabels: [],
  startsFrom: null,
  startsBefore: null,
  titleContains: null,
  tags: [],
  staffNeeded: 1,
  ...over,
});

// Thu 2026-10-29 and Sat 2026-10-31.
const thursdayMorning: StaffingTarget = {
  date: '2026-10-29',
  startMin: 8 * 60,
  label: 'Morning',
  titles: ['Open Hours'],
  tags: ['open-hours'],
};
const saturdayAfternoon: StaffingTarget = {
  date: '2026-10-31',
  startMin: 12 * 60,
  label: 'Afternoon',
  titles: ['Open Hours', 'Guided Sauna Journey'],
  tags: ['open-hours', 'guided'],
};

describe('staffing rules', () => {
  it('matches every condition it sets, and ignores the ones it leaves empty', () => {
    const thuFriMornings = rule({ days: [4, 5], shiftLabels: ['morning'] });
    expect(staffingRuleMatches(thuFriMornings, thursdayMorning)).toBe(true);
    expect(staffingRuleMatches(thuFriMornings, saturdayAfternoon)).toBe(false);
    expect(staffingRuleMatches(rule(), saturdayAfternoon)).toBe(true);
  });

  it('matches start time bounds, title text, and tags case-insensitively', () => {
    expect(staffingRuleMatches(rule({ startsFrom: '11:00' }), saturdayAfternoon)).toBe(true);
    expect(staffingRuleMatches(rule({ startsFrom: '11:00' }), thursdayMorning)).toBe(false);
    expect(staffingRuleMatches(rule({ startsBefore: '12:00' }), saturdayAfternoon)).toBe(false);
    expect(staffingRuleMatches(rule({ titleContains: 'GUIDED' }), saturdayAfternoon)).toBe(true);
    expect(staffingRuleMatches(rule({ titleContains: 'guided' }), thursdayMorning)).toBe(false);
    expect(staffingRuleMatches(rule({ tags: ['Guided', 'event'] }), saturdayAfternoon)).toBe(true);
    expect(staffingRuleMatches(rule({ tags: ['event'] }), saturdayAfternoon)).toBe(false);
  });

  it('takes the first enabled match, falling back when none match', () => {
    const rules = [
      rule({ id: 'off', enabled: false, staffNeeded: 9 }),
      rule({ id: 'guided-sat', days: [6], tags: ['guided'], staffNeeded: 3 }),
      rule({ id: 'mornings', days: [4, 5], shiftLabels: ['Morning'], staffNeeded: 1 }),
    ];
    expect(matchStaffingRule(rules, saturdayAfternoon)?.id).toBe('guided-sat');
    expect(staffNeededFor(rules, saturdayAfternoon)).toBe(3);
    expect(staffNeededFor(rules, thursdayMorning)).toBe(1);
    expect(staffNeededFor(rules, { ...thursdayMorning, date: '2026-10-27' })).toBe(
      DEFAULT_STAFF_NEEDED
    );
    expect(staffNeededFor([], thursdayMorning, 4)).toBe(4);
  });

  it('describes a rule in one line', () => {
    expect(describeStaffingRule(rule({ days: [5, 4], shiftLabels: ['Morning'] }))).toBe(
      'Thu, Fri · Morning'
    );
    expect(describeStaffingRule(rule())).toBe('Every shift');
  });

  it('validates and cleans editor input', () => {
    expect(
      parseStaffingRule({
        id: 'a',
        name: ' Sat ',
        days: [6, 6],
        tags: ['guided', 'Guided', ' '],
        startsFrom: '11:00:00',
        staffNeeded: 3,
      })
    ).toEqual(
      rule({
        id: 'a',
        name: 'Sat',
        days: [6],
        tags: ['guided'],
        startsFrom: '11:00',
        staffNeeded: 3,
      })
    );
    expect(parseStaffingRule({ id: 'a', staffNeeded: 21 })).toMatch(/people needed/);
    expect(parseStaffingRule({ id: 'a', days: [7], staffNeeded: 1 })).toMatch(/days/);
    expect(
      parseStaffingRule({ id: 'a', startsFrom: '12:00', startsBefore: '11:00', staffNeeded: 1 })
    ).toMatch(/later than/);
    expect(parseStaffingRule({ staffNeeded: 1 })).toMatch(/id/);
  });
});
