// Staffing rules: how many people a shift needs, decided by an ordered list
// of admin rules instead of one number for every shift. Each rule is a set of
// conditions (days of the week, shift label, start time, session title,
// session tag) and a head count; the first enabled rule whose conditions all
// hold wins, and a shift no rule matches gets the fallback. An empty
// condition matches anything, so a rule with none at all is a catch-all.
//
// The sync applies these to the shifts it creates from Momence, and re-applies
// them to the shifts it already tracks unless an admin set that shift's count
// by hand (shifts.staff_needed_manual). Pure — rows in, numbers out.

import { dayOfWeek, timeToMinutes } from './availability';

/** What a shift needs when no rule matches — the sync's long-standing default. */
export const DEFAULT_STAFF_NEEDED = 2;
export const MAX_STAFF_NEEDED = 20;
export const MAX_STAFFING_RULES = 50;
export const STAFFING_RULE_NAME_MAX = 80;
export const STAFFING_RULE_TEXT_MAX = 80;

export interface StaffingRule {
  id: string;
  /** The admin's name for it, e.g. "Weekday mornings". */
  name: string;
  enabled: boolean;
  /** Days of the week, 0 = Sunday … 6 = Saturday. Empty = any day. */
  days: number[];
  /** Shift labels (Morning, Afternoon, …), case-insensitive. Empty = any. */
  shiftLabels: string[];
  /** The shift starts at or after this time (HH:MM). Null = no lower bound. */
  startsFrom: string | null;
  /** The shift starts before this time (HH:MM). Null = no upper bound. */
  startsBefore: string | null;
  /** Some session on the shift has a title containing this, case-insensitive. */
  titleContains: string | null;
  /** Some session on the shift carries one of these Momence tags. Empty = any. */
  tags: string[];
  staffNeeded: number;
}

/** What the matcher needs to know about a shift. */
export interface StaffingTarget {
  date: string;
  startMin: number;
  label: string;
  /** Titles of the sessions the shift covers. */
  titles: string[];
  /** Momence tags across those sessions. */
  tags: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** True when every condition the rule sets holds for the shift. */
export function staffingRuleMatches(rule: StaffingRule, target: StaffingTarget): boolean {
  if (rule.days.length > 0 && !rule.days.includes(dayOfWeek(target.date))) return false;
  if (
    rule.shiftLabels.length > 0 &&
    !rule.shiftLabels.some((label) => norm(label) === norm(target.label))
  ) {
    return false;
  }
  if (rule.startsFrom && target.startMin < timeToMinutes(rule.startsFrom)) return false;
  if (rule.startsBefore && target.startMin >= timeToMinutes(rule.startsBefore)) return false;
  if (rule.titleContains) {
    const needle = norm(rule.titleContains);
    if (needle && !target.titles.some((title) => norm(title).includes(needle))) return false;
  }
  if (rule.tags.length > 0) {
    const have = new Set(target.tags.map(norm));
    if (!rule.tags.some((tag) => have.has(norm(tag)))) return false;
  }
  return true;
}

/** The first enabled rule that matches, or null. */
export function matchStaffingRule(
  rules: StaffingRule[],
  target: StaffingTarget
): StaffingRule | null {
  return rules.find((rule) => rule.enabled && staffingRuleMatches(rule, target)) ?? null;
}

/** How many people the shift needs: the first matching rule's count, else the fallback. */
export function staffNeededFor(
  rules: StaffingRule[],
  target: StaffingTarget,
  fallback: number = DEFAULT_STAFF_NEEDED
): number {
  return matchStaffingRule(rules, target)?.staffNeeded ?? fallback;
}

/** A one-line reading of a rule's conditions, e.g. "Thu, Fri · Morning · tag guided". */
export function describeStaffingRule(rule: StaffingRule): string {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const parts: string[] = [];
  if (rule.days.length > 0) {
    parts.push(
      [...rule.days]
        .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map((d) => DAY[d])
        .join(', ')
    );
  }
  if (rule.shiftLabels.length > 0) parts.push(rule.shiftLabels.join(' or '));
  if (rule.startsFrom && rule.startsBefore) {
    parts.push(`starts ${rule.startsFrom}–${rule.startsBefore}`);
  } else if (rule.startsFrom) {
    parts.push(`starts ${rule.startsFrom} or later`);
  } else if (rule.startsBefore) {
    parts.push(`starts before ${rule.startsBefore}`);
  }
  if (rule.titleContains) parts.push(`title has "${rule.titleContains}"`);
  if (rule.tags.length > 0) parts.push(`tag ${rule.tags.join(' or ')}`);
  return parts.length > 0 ? parts.join(' · ') : 'Every shift';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function stringList(raw: unknown, field: string): string[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return `${field} must be a list`;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return `${field} must be a list of text`;
    const trimmed = item.trim();
    if (trimmed.length > STAFFING_RULE_TEXT_MAX) return `${field} entries are too long`;
    if (trimmed && !out.some((o) => norm(o) === norm(trimmed))) out.push(trimmed);
  }
  return out;
}

function optionalTime(raw: unknown, field: string): string | null | { error: string } {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !HHMM.test(raw.slice(0, 5))) {
    return { error: `${field} must be HH:MM` };
  }
  return raw.slice(0, 5);
}

/**
 * Validate one rule from the editor or a stored row. Returns the cleaned rule
 * or an error naming what's wrong.
 */
export function parseStaffingRule(raw: unknown): StaffingRule | string {
  if (typeof raw !== 'object' || raw === null) return 'Each rule must be an object';
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : null;
  if (!id) return 'Each rule needs an id';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (name.length > STAFFING_RULE_NAME_MAX) return 'Rule names are 80 characters at most';

  const daysRaw = r.days ?? [];
  if (!Array.isArray(daysRaw)) return 'days must be a list';
  const days: number[] = [];
  for (const d of daysRaw) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) {
      return 'days must be numbers from 0 (Sunday) to 6 (Saturday)';
    }
    if (!days.includes(d)) days.push(d);
  }

  const shiftLabels = stringList(r.shiftLabels, 'shiftLabels');
  if (typeof shiftLabels === 'string') return shiftLabels;
  const tags = stringList(r.tags, 'tags');
  if (typeof tags === 'string') return tags;

  const startsFrom = optionalTime(r.startsFrom, 'startsFrom');
  if (startsFrom && typeof startsFrom === 'object') return startsFrom.error;
  const startsBefore = optionalTime(r.startsBefore, 'startsBefore');
  if (startsBefore && typeof startsBefore === 'object') return startsBefore.error;
  if (startsFrom && startsBefore && startsBefore <= startsFrom) {
    return `${name || 'A rule'}: "starts before" must be later than "starts from"`;
  }

  let titleContains: string | null = null;
  if (r.titleContains !== undefined && r.titleContains !== null) {
    if (typeof r.titleContains !== 'string') return 'titleContains must be text';
    const trimmed = r.titleContains.trim();
    if (trimmed.length > STAFFING_RULE_TEXT_MAX) return 'titleContains is too long';
    titleContains = trimmed || null;
  }

  const staffNeeded = r.staffNeeded;
  if (
    typeof staffNeeded !== 'number' ||
    !Number.isInteger(staffNeeded) ||
    staffNeeded < 0 ||
    staffNeeded > MAX_STAFF_NEEDED
  ) {
    return `${name || 'A rule'}: people needed must be a whole number from 0 to ${MAX_STAFF_NEEDED}`;
  }

  return {
    id,
    name,
    enabled: r.enabled !== false,
    days,
    shiftLabels,
    startsFrom,
    startsBefore,
    titleContains,
    tags,
    staffNeeded,
  };
}
