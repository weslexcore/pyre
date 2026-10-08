// One person's notification preferences: which kinds of notification reach
// their inbox. Scoped to the session's own email like the inbox itself —
// nobody reads or sets anyone else's. Any dashboard user has them.
//
//   GET                         → { muted: kind[], kinds: KindOption[] }
//   PUT { muted: kind[] }       → { ok, muted }
//
// Delivery is opt-out: `muted` lists the kinds switched off, and everything
// else arrives. `kinds` is what the panel offers this person (admin-only
// kinds only for admins), with the always-on kinds marked `required`. PUT
// replaces the whole list; it only accepts kinds this person is offered and
// may switch off. CSRF-guarded in-route like every cookie-authed mutation.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireStaff } from '@/lib/auth/admin';
import { getDb, type NotificationKind } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { json } from '@/lib/http/route';
import { getMutedKinds, setMutedKinds } from '@/lib/notifications/notify';
import {
  isNotificationKind,
  normalizeMutedKinds,
  preferenceOptions,
} from '@/lib/notifications/types';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const { muted, error } = await getMutedKinds(db, email);
  if (error) return json({ error }, 500);

  // A kind switched off while it was still offered (an admin since made
  // staff) isn't drawn, so it isn't reported either — the next PUT drops it.
  const kinds = preferenceOptions(gate.access.isAdmin);
  const offered = new Set(kinds.map((option) => option.kind));
  return json({ muted: muted.filter((kind) => offered.has(kind)), kinds });
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const offered = new Set(
    preferenceOptions(gate.access.isAdmin)
      .filter((option) => !option.required)
      .map((option) => option.kind)
  );
  const raw = body.muted;
  if (
    !Array.isArray(raw) ||
    !raw.every((kind): kind is NotificationKind => isNotificationKind(kind) && offered.has(kind))
  ) {
    return json({ error: 'muted must list notification kinds you can switch off' }, 400);
  }

  const muted = normalizeMutedKinds(raw);
  const error = await setMutedKinds(db, email, muted);
  if (error) return json({ error }, 500);

  return json({ ok: true, muted });
};
