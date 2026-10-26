// The staffing rules on the schedule board's Settings panel: an ordered list
// deciding how many people each shift needs (lib/schedule/staffing-rules.ts,
// matching in @pyre/schedule-core staffing.ts). Admin-only, like the other
// schedule settings — the counts drive what every shift reads as covered.
//
// PUT replaces the whole list, then runs the Momence sync so the new counts
// reach the shifts already on the board right away (shifts whose count an
// admin set by hand are left alone). A failed sync doesn't undo the save —
// the hourly run applies the rules anyway.

import {
  DEFAULT_STAFF_NEEDED,
  MAX_STAFFING_RULES,
  parseStaffingRule,
  type StaffingRule,
} from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { actorFromGate } from '@/lib/schedule/change-log';
import { loadStaffingRules, saveStaffingRules } from '@/lib/schedule/staffing-rules';
import { syncShifts } from '@/lib/schedule/sync';

export const prerender = false;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const rules = await loadStaffingRules();
  if (rules === null) return json({ error: 'Could not load staffing rules' }, 500);
  return json({ rules, fallback: DEFAULT_STAFF_NEEDED });
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: { rules?: unknown };
  try {
    body = (await request.json()) as { rules?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!Array.isArray(body.rules)) return json({ error: 'rules must be a list' }, 400);
  if (body.rules.length > MAX_STAFFING_RULES) {
    return json({ error: `At most ${MAX_STAFFING_RULES} rules` }, 400);
  }

  const rules: StaffingRule[] = [];
  const seen = new Set<string>();
  for (const raw of body.rules) {
    const rule = parseStaffingRule(raw);
    if (typeof rule === 'string') return json({ error: rule }, 400);
    if (!ID_RE.test(rule.id)) return json({ error: 'Rule ids must be letters, digits or -' }, 400);
    if (seen.has(rule.id)) return json({ error: 'Rule ids must be unique' }, 400);
    seen.add(rule.id);
    rules.push(rule);
  }

  const updatedBy = (gate.user.email ?? '').toLowerCase() || null;
  const { error } = await saveStaffingRules(rules, updatedBy);
  if (error) return json({ error }, 500);

  let sync: { staffingUpdated: number } | { error: string };
  try {
    const summary = await syncShifts({ actor: actorFromGate(gate) });
    sync = { staffingUpdated: summary.staffingUpdated };
  } catch (e) {
    sync = { error: e instanceof Error ? e.message : 'Sync failed' };
  }

  return json({ rules: (await loadStaffingRules()) ?? rules, sync });
};
