// The scheduler agent's off-shift duty days (save_proposal's
// dutyAssignments), checked before /api/agent/proposals writes them as
// drafts. Pure — the route reads the days already handed out and passes them
// in as `taken`.
//
// Two kinds of failure, as the route reports them: a malformed entry (not a
// live off-shift duty, outside the week, a day it isn't done, an unknown or
// off-roster person, the same day twice) fails the request with 400; a
// well-formed day that can't be given as drafted (already assigned, the
// person can't do it, or they're off the whole day) is listed in `problems`
// so the agent can fix them all in one go.

import {
  availabilityFor,
  type DutyCatalog,
  type DutyTraining,
  dutyDef,
  dutyRunsOn,
  isTrainedFor,
  type StaffRow,
  type TimeOffRow,
} from '@pyre/schedule-core';
import { DATE_RE } from '@/lib/schedule/validate';

export interface DraftDuty {
  dutyKey: string;
  date: string;
  staffId: string;
}

export type DraftDutyCheck =
  | { ok: true; duties: DraftDuty[] }
  | { ok: false; error: string }
  | { ok: false; problems: string[] };

export function checkDraftDuties(
  raw: readonly unknown[],
  ctx: {
    catalog: DutyCatalog;
    training: DutyTraining;
    staffById: ReadonlyMap<string, StaffRow>;
    timeOff: readonly TimeOffRow[];
    weekStart: string;
    weekEnd: string;
    /** "dutyKey:date" for each day already handed out live. */
    taken: ReadonlySet<string>;
  }
): DraftDutyCheck {
  const { catalog, training, staffById, timeOff, weekStart, weekEnd, taken } = ctx;
  const duties: DraftDuty[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    const d = (entry ?? {}) as Record<string, unknown>;
    const dutyKey = typeof d.dutyKey === 'string' ? d.dutyKey : '';
    const date = typeof d.date === 'string' ? d.date : '';
    const staffId = d.staffId;
    const def = dutyDef(catalog, dutyKey);
    if (def?.phase !== 'off_shift' || def.archived) {
      return {
        ok: false,
        error: `dutyAssignments[${i}]: '${dutyKey}' is not a live off-shift duty`,
      };
    }
    if (!DATE_RE.test(date) || date < weekStart || date > weekEnd) {
      return { ok: false, error: `dutyAssignments[${i}]: date must be in the week ${weekStart}` };
    }
    if (!dutyRunsOn(def, date)) {
      return { ok: false, error: `dutyAssignments[${i}]: ${def.label} isn't done on ${date}` };
    }
    if (typeof staffId !== 'string' || !staffById.get(staffId)?.active) {
      return { ok: false, error: `dutyAssignments[${i}]: unknown or inactive staffId` };
    }
    const dayKey = `${dutyKey}:${date}`;
    if (seen.has(dayKey)) {
      return { ok: false, error: `dutyAssignments[${i}]: ${def.label} on ${date} given twice` };
    }
    seen.add(dayKey);
    duties.push({ dutyKey, date, staffId });
  }

  const label = (key: string) => dutyDef(catalog, key)?.label ?? key;
  const name = (id: string) => staffById.get(id)?.display_name ?? '?';
  const problems = duties.flatMap((d) => {
    const out: string[] = [];
    if (taken.has(`${d.dutyKey}:${d.date}`)) {
      out.push(`${label(d.dutyKey)} on ${d.date} is already assigned`);
    }
    if (!isTrainedFor(catalog, training, d.staffId, d.dutyKey)) {
      out.push(`${name(d.staffId)} can't do ${label(d.dutyKey)} (not in its trainedStaffIds)`);
    }
    if (availabilityFor([...timeOff], d.staffId, d.date, 0, 24 * 60).status === 'busy') {
      out.push(`${name(d.staffId)} is off all day ${d.date}`);
    }
    return out;
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, duties };
}
