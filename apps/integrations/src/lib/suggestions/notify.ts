// New suggestions → the admins' bells. One notification per source record,
// replaced (not added to) when a later run files more, and marked read for
// everyone once nothing on that record is left to decide. Best-effort like
// every notifier.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import { createNotifications, resolveSourceForAll } from '@/lib/notifications/notify';
import { adminEmails } from '@/lib/notifications/recipients';
import { daysFromNow } from '@/lib/notifications/types';
import type { SourceRecord } from './sources';
import { countPendingFor } from './store';
import { describeSuggestion, type SuggestionKind, type SuggestionSourceType } from './types';

const SUGGESTION_NOTICE_DAYS = 30;

/** The notification's source key: one per record, whatever the run. */
export function suggestionNoticeSource(type: SuggestionSourceType, id: string) {
  return { type: 'suggestion', id: `${type}:${id}` };
}

export async function notifySuggestionsReady(
  db: SupabaseClient,
  source: SourceRecord,
  suggestions: ReadonlyArray<{ kind: SuggestionKind; payload: unknown }>
): Promise<void> {
  if (suggestions.length === 0) return;
  const pending = await countPendingFor(db, source.type, source.id);
  const count = Math.max(pending, suggestions.length);
  const rows = (await listStaff()) ?? [];
  await createNotifications(db, adminEmails(rows), {
    kind: 'agent_suggestion',
    title: `${count} suggestion${count === 1 ? '' : 's'} from ${source.label}`,
    body: suggestions
      .slice(0, 3)
      .map((s) => describeSuggestion(s.kind, s.payload))
      .join(' · '),
    href: source.href,
    source: suggestionNoticeSource(source.type, source.id),
    expiresAt: daysFromNow(SUGGESTION_NOTICE_DAYS),
    supersede: true,
  });
}

/** Once a record has nothing left to decide, its notice stops counting for everyone. */
export async function resolveSuggestionNotice(
  db: SupabaseClient,
  type: SuggestionSourceType,
  id: string
): Promise<void> {
  if ((await countPendingFor(db, type, id)) > 0) return;
  const key = suggestionNoticeSource(type, id);
  await resolveSourceForAll(db, key.type, key.id);
}
