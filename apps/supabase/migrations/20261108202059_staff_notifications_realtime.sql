-- Live inbox updates for the dashboard bell (apps/integrations). Until now
-- the bell polled /api/admin/notifications every minute; now every change to
-- a person's inbox row is broadcast on a private Realtime channel of their
-- own and the bell listens (the poll stays as a fallback for a socket that
-- never connected).
--
-- Broadcast from the database: an AFTER trigger calls realtime.send(), so
-- every writer of staff_notifications — the API routes, the Momence sync —
-- is covered without touching their code. realtime.send() swallows its own
-- errors, so a Realtime outage never fails the write. One topic per
-- recipient, keyed by the same lowercased email the rows are:
-- 'notif:<email>' (apps/integrations/src/lib/notifications/realtime.ts).
--
-- Additive: with no subscribers the broadcasts go nowhere and cost one
-- function call per write. "Mark all read" fans out one message per row;
-- the bell coalesces a burst into one refetch.

create or replace function public.staff_notifications_broadcast()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'op', tg_op,
      'unread', new.read_at is null and new.dismissed_at is null
    ),
    'changed',
    'notif:' || new.recipient_email,
    true
  );
  return null;
end;
$$;

comment on function public.staff_notifications_broadcast() is
  'AFTER trigger on staff_notifications: broadcasts {id, op, unread} on the recipient''s private Realtime topic notif:<email> so their bell refetches at once.';

create trigger staff_notifications_broadcast
  after insert or update of read_at, dismissed_at on public.staff_notifications
  for each row execute function public.staff_notifications_broadcast();

-- Who may listen: a signed-in person, on their own topic only. Realtime
-- evaluates this when a client subscribes to a private channel, with the
-- JWT the browser handed it (/api/auth/realtime-token).
create policy "staff receive their own notification broadcasts"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'notif:' || lower((select auth.jwt() ->> 'email'))
  );
