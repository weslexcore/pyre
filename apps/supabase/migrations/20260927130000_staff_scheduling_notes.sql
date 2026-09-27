-- Free-text scheduling preferences, per person, beside the numeric ones.
-- The shift counts and h/wk target say how big someone's week should be, but
-- not its shape: "1-2 mornings a month", "no mornings unless you're stuck",
-- "I'd rather have my shifts back to back". Staff write that in their own
-- words on the Hours tab (/admin/schedule/hours); the AI drafter reads it
-- through get_week_context and treats it as a soft preference — below the
-- hard rules and the admin's own notes.
--
-- text, NULLABLE, no default: null (or blank, which the API stores as null)
-- means nothing to add. Capped at 1000 characters, the same size as an
-- admin's draft note.
--
-- Set and redacted like the shift-count preferences: the owner and schedule
-- managers see and edit it via /api/admin/staff-preferences; it's nulled
-- server-side for everyone else (redactPay in schedule-board.ts). Edits land
-- in the schedule change log under 'staff_prefs'. The existing admin-only
-- select policy on staff covers the column at the RLS layer.
alter table public.staff
  add column if not exists scheduling_notes text
    constraint staff_scheduling_notes_length check (
      scheduling_notes is null or char_length(scheduling_notes) <= 1000
    );

comment on column public.staff.scheduling_notes is
  'Free-text scheduling preferences in the person''s own words ("1-2 mornings a month"), set on /admin/schedule/hours by the person or a schedule manager. Null = none. A soft preference for the AI drafter. Visible to the owner and schedule managers.';
