// Structured log reads for the knowledge assistant: the cold tub water log,
// shift notes, and one incident report. Each is gated by the asker's scope
// exactly as the dashboard gates the page (see lib/role.ts), and incident
// reads return the narrative only — never the people fields.

import { getDb } from '../db';
import type { KnowledgeScope } from '../role';
import { incidentUrl, SHIFT_NOTES_URL_PATH, siteUrl, WATER_LOG_URL_PATH } from './urls';

const EASTERN = 'America/New_York';

function easternDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: EASTERN });
}

function easternDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: EASTERN,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface WaterTestRow {
  id: string;
  tub: 'left' | 'right';
  entry_type: 'test' | 'shock' | 'refill';
  ta_ppm: number | null;
  ph: number | null;
  free_chlorine_ppm: number | null;
  combined_chlorine_ppm: number | null;
  salt_ppm: number | null;
  test_method: string | null;
  doses: Array<{ chemical?: string; grams?: number; reason?: string; recommended_grams?: number }>;
  notes: string | null;
  recorded_by: string;
  created_at: string;
}

export interface WaterLogInput {
  tub?: 'left' | 'right';
  days?: number;
  limit?: number;
}

/** Recent cold tub water log entries, newest first. */
export async function getWaterLog(scope: KnowledgeScope, input: WaterLogInput) {
  if (!scope.water) {
    return {
      available: false as const,
      error:
        'This staff member does not hold the Cold Tub Water Log page, so the water log is not available to them.',
    };
  }
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = getDb()
    .from('water_tests')
    .select(
      'id, tub, entry_type, ta_ppm, ph, free_chlorine_ppm, combined_chlorine_ppm, salt_ppm, test_method, doses, notes, recorded_by, created_at'
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (input.tub) query = query.eq('tub', input.tub);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as WaterTestRow[];
  return {
    available: true as const,
    url: siteUrl(WATER_LOG_URL_PATH),
    windowDays: days,
    count: rows.length,
    entries: rows.map((row) => ({
      id: row.id,
      recordedAt: easternDateTime(row.created_at),
      tub: row.tub,
      entryType: row.entry_type,
      readings: {
        taPpm: row.ta_ppm,
        ph: row.ph,
        freeChlorinePpm: row.free_chlorine_ppm,
        combinedChlorinePpm: row.combined_chlorine_ppm,
        saltPpm: row.salt_ppm,
        testMethod: row.test_method,
      },
      doses: row.doses.map((d) => ({
        chemical: d.chemical ?? null,
        grams: d.grams ?? null,
        recommendedGrams: d.recommended_grams ?? null,
        reason: d.reason ?? null,
      })),
      notes: row.notes,
    })),
  };
}

interface ShiftNoteRow {
  id: string;
  note_date: string;
  body: string;
  author_email: string;
  created_at: string;
}

export interface ShiftNotesInput {
  from?: string;
  to?: string;
  limit?: number;
}

/** Shift notes in a date window, newest shift first. Admins read all, others their own. */
export async function getShiftNotes(scope: KnowledgeScope, input: ShiftNotesInput) {
  if (!scope.shiftNotes) {
    return {
      available: false as const,
      error: 'This staff member does not hold the Shift Notes page, so shift notes are not available to them.',
    };
  }
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  let query = getDb()
    .from('shift_notes')
    .select('id, note_date, body, author_email, created_at')
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (input.from) query = query.gte('note_date', input.from);
  if (input.to) query = query.lte('note_date', input.to);
  if (scope.shiftNotes === 'mine') query = query.eq('author_email', scope.email);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ShiftNoteRow[];
  return {
    available: true as const,
    scope: scope.shiftNotes,
    url: siteUrl(SHIFT_NOTES_URL_PATH),
    count: rows.length,
    notes: rows.map((row) => ({
      id: row.id,
      shiftDate: row.note_date,
      writtenAt: easternDateTime(row.created_at),
      author: row.author_email,
      body: row.body,
    })),
  };
}

interface IncidentRow {
  id: string;
  reference: string;
  status: string;
  category: string;
  severity: string;
  occurred_at: string;
  area: string;
  area_detail: string | null;
  description: string;
  immediate_actions: string;
  first_aid_given: boolean;
  ems_called: boolean;
  transported_to_hospital: boolean;
  contributing_factors: string[];
  equipment_involved: string | null;
  sauna_temp_f: number | null;
  water_temp_f: number | null;
  follow_up_required: boolean;
  follow_up_notes: string | null;
  corrective_actions: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  reported_by: string;
  reported_at: string;
}

/**
 * One incident report by reference (INC-YYYY-NNNN), narrative fields only:
 * affected people, witnesses, and contact details never leave the database
 * through this path.
 */
export async function readIncident(scope: KnowledgeScope, reference: string) {
  if (!scope.incidents) {
    return {
      available: false as const,
      error:
        'This staff member does not hold the Incident Reports page, so incident reports are not available to them.',
    };
  }
  const { data, error } = await getDb()
    .from('incidents')
    .select(
      'id, reference, status, category, severity, occurred_at, area, area_detail, description, immediate_actions, first_aid_given, ems_called, transported_to_hospital, contributing_factors, equipment_involved, sauna_temp_f, water_temp_f, follow_up_required, follow_up_notes, corrective_actions, resolution_notes, resolved_at, reported_by, reported_at'
    )
    .eq('reference', reference.trim().toUpperCase())
    .neq('status', 'voided')
    .maybeSingle();
  if (error) throw new Error(error.message);

  const row = data as IncidentRow | null;
  if (!row || (scope.incidents === 'mine' && row.reported_by.toLowerCase() !== scope.email)) {
    return {
      available: true as const,
      found: false as const,
      error: `No incident ${reference} is available to this staff member.`,
    };
  }

  return {
    available: true as const,
    found: true as const,
    url: incidentUrl(row.id),
    reference: row.reference,
    status: row.status,
    category: row.category,
    severity: row.severity,
    occurredAt: easternDateTime(row.occurred_at),
    occurredOn: easternDate(row.occurred_at),
    area: row.area,
    areaDetail: row.area_detail,
    description: row.description,
    immediateActions: row.immediate_actions,
    response: {
      firstAidGiven: row.first_aid_given,
      emsCalled: row.ems_called,
      transportedToHospital: row.transported_to_hospital,
    },
    contributingFactors: row.contributing_factors,
    equipmentInvolved: row.equipment_involved,
    saunaTempF: row.sauna_temp_f,
    waterTempF: row.water_temp_f,
    followUpRequired: row.follow_up_required,
    followUpNotes: row.follow_up_notes,
    correctiveActions: row.corrective_actions,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at ? easternDateTime(row.resolved_at) : null,
    reportedAt: easternDateTime(row.reported_at),
  };
}
