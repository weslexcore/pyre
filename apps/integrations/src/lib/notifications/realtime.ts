// The Realtime channel a person's inbox broadcasts on. The database trigger
// on staff_notifications (see the staff_notifications_realtime migration)
// sends to this topic, the realtime.messages policy lets only that person
// subscribe to it, and the bell listens. Keyed by email like the rows
// themselves, so it works for env-allowlisted admins with no staff row too.
// Pure — shared by the token route, the bell, and the migration's intent.

import { normalizeEmail } from '@/lib/email/address';

export const NOTIFICATION_EVENT = 'changed';

export function notificationTopic(email: string): string {
  return `notif:${normalizeEmail(email)}`;
}
