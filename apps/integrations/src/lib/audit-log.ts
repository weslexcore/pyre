// The audit-trail writer/reader behind each record type's `*_events` table
// (incidents, lost-and-found). Every mutation goes through one of these, so
// "who changed what, when" is a property of the system rather than something
// each route remembers to do.
//
// Server-only (takes a service-role client). Write failures are logged and
// swallowed: losing an audit line is bad, but failing the staff member's
// change because the trail write failed would be worse. The row itself is
// already saved by the time we get here.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEventInput<Action extends string> {
  /** The id of the record the event belongs to. */
  subjectId: string;
  action: Action;
  /** Session email of whoever did it, or a system actor ('cron', 'guest'). */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

export interface AuditLog<Row extends { action: string }> {
  log(db: SupabaseClient, event: AuditEventInput<Row['action']>): Promise<void>;
  /** The full trail for one record, oldest first. */
  load(db: SupabaseClient, subjectId: string): Promise<Row[]>;
}

export function auditLog<Row extends { action: string }>(opts: {
  table: string;
  /** The column holding the record's id. */
  fkColumn: string;
  /** Log prefix, e.g. 'incidents'. */
  scope: string;
}): AuditLog<Row> {
  return {
    async log(db, event) {
      const { error } = await db.from(opts.table).insert({
        [opts.fkColumn]: event.subjectId,
        action: event.action,
        actor: event.actor,
        detail: event.detail ?? {},
        note: event.note ?? null,
      });
      if (error) {
        console.error(`[${opts.scope}] audit write failed (${event.action}):`, error.message);
      }
    },
    async load(db, subjectId) {
      const { data, error } = await db
        .from(opts.table)
        .select('*')
        .eq(opts.fkColumn, subjectId)
        .order('created_at', { ascending: true });
      if (error) {
        console.error(`[${opts.scope}] audit read failed:`, error.message);
        return [];
      }
      return (data ?? []) as Row[];
    },
  };
}
