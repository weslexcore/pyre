// This app's side of each classifiable subject: where its text lives and who
// may look at and re-run its classification. The subject list itself (and
// what the model is told about each) is @pyre/signals-core's SUBJECT_DEFINITIONS;
// the Record type below makes a new subject there a type error here until it
// is wired up.

import type { SubjectType } from '@pyre/signals-core';
import type { AstroCookies } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, requirePage } from '@/lib/auth/admin';
import type { getDb } from '@/lib/db';

type Db = NonNullable<ReturnType<typeof getDb>>;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status: 403, headers: JSON_HEADERS });
}

export interface SubjectSource {
  /**
   * Gate a request to read or re-run classifications of this subject: the
   * gate, or a ready-to-return error Response. Signals are triage material,
   * so this is usually narrower than who may read the record itself.
   */
  authorize(cookies: AstroCookies): Promise<AdminGate | Response>;
  /** The record's current text, or null when it does not exist. */
  loadText(db: Db, id: string): Promise<string | null>;
}

export const SUBJECT_SOURCES: Record<SubjectType, SubjectSource> = {
  shift_note: {
    // Admins triage the log (lib/shift-notes/access: canSetStatus), so they
    // are the ones who see what the classifier found.
    async authorize(cookies) {
      const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
      if (gate instanceof Response) return gate;
      return gate.access.isAdmin ? gate : forbidden('Only admins see shift note signals');
    },
    async loadText(db, id) {
      const { data } = await db.from('shift_notes').select('body').eq('id', id).maybeSingle();
      return (data as { body: string } | null)?.body ?? null;
    },
  },
};
