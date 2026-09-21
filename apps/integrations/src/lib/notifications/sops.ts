// An SOP was saved → everyone who can read it hears. Called from the SOP
// routes after the version row and the document update both succeed;
// best-effort like every notifier.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import type { SopRow } from '@/lib/db';
import { createNotifications } from './notify';
import { nameFor, sopUpdateRecipients } from './recipients';
import { sopSavedText } from './text';
import { daysFromNow } from './types';

const SOP_NOTICE_DAYS = 14;

export async function notifySopSaved(
  db: SupabaseClient,
  input: {
    sop: Pick<
      SopRow,
      | 'id'
      | 'slug'
      | 'title'
      | 'view_roles'
      | 'edit_roles'
      | 'view_emails'
      | 'edit_emails'
      | 'archived'
    >;
    editorEmail: string;
    version: number;
    created: boolean;
    changeNote?: string | null;
  }
): Promise<void> {
  if (input.sop.archived) return;
  const rows = (await listStaff()) ?? [];
  const recipients = sopUpdateRecipients(rows, input.sop);
  const text = sopSavedText({
    title: input.sop.title,
    version: input.version,
    created: input.created,
    changeNote: input.changeNote,
    editorName: nameFor(rows, input.editorEmail),
  });
  await createNotifications(db, recipients, {
    kind: 'sop_updated',
    ...text,
    href: `/admin/sops/${input.sop.slug}`,
    source: { type: 'sop', id: input.sop.id },
    actorEmail: input.editorEmail,
    expiresAt: daysFromNow(SOP_NOTICE_DAYS),
    supersede: true,
  });
}
