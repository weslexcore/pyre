-- @-mentions. Anywhere people talk to each other in the dashboard — admin
-- messages and their replies, shift notes and their replies, card and goal
-- comments, the follow-up notes on an incident — a person can be named with
-- `@<email>`, and whoever is named hears about it in the bell under its own
-- kind. A mention is how a teammate reaches you in particular, so like
-- admin_message it can't be switched off (lib/notifications/types).
--
-- No new columns: a mention is a staff_notifications row like any other,
-- pointing at the message, note, card, goal, or incident it was written on.

alter table public.staff_notifications drop constraint staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check check (
    kind in (
      'admin_message',
      'message_reply',
      'mention',
      'sop_updated',
      'schedule_change',
      'shift_note_reply',
      'sub_request',
      'goal_activity',
      'agent_suggestion',
      'inventory_low',
      'agent_routine'
    )
  );

comment on column public.staff_notifications.kind is
  'What kind of event this is: admin_message, message_reply, mention (someone named you with @ in a message, reply, comment, or note), sop_updated, schedule_change, shift_note_reply, sub_request, goal_activity, agent_suggestion, inventory_low, agent_routine. Drives the chip and the per-kind preferences.';
