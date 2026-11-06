-- Record why an event-triggered enrollment was turned down.
--
-- A Momence event (a purchase, a session booking) hands a member to every
-- journey with that trigger, and the engine can then decline them: the entry
-- condition did not hold, the journey is in test mode and they are not on the
-- whitelist, it is not their first booking, they are already in the journey,
-- or they finished it too recently. Nothing recorded that, so a member who
-- vanished at the door was only findable in the logs. These rows make the
-- refusal visible on /admin/journeys: the Performance tab counts them and
-- their reasons, the People tab lists who, so an admin can add them by hand.
--
--   * kind 'not-enrolled' — the member was considered and not enrolled.
--   * enrollment_id       — null on not-enrolled rows: there is no run to
--                           attach to. Existing rows are untouched; the
--                           column only stops being required.
--   * email               — lowercase, like journey_enrollments.email. Set on
--                           not-enrolled rows so the People tab can name the
--                           person without an enrollment to join to; null on
--                           every row written before this migration.
--   * detail              — enroll-if:<condition> (the entry condition, as the
--                           editor shows it, that did not hold; not-<condition>
--                           when the editor negates it), not-whitelisted,
--                           not-first-booking, already-enrolled, cooling-down,
--                           check-failed:<message>; the app turns it into words.
--
-- Sweep enrollment (the cron job) does not write these rows: it re-checks
-- every candidate on every tick and would log hundreds per run. Still
-- append-only and best-effort: the engine never fails a trigger because this
-- write failed.

alter table public.journey_step_events
  alter column enrollment_id drop not null;

alter table public.journey_step_events
  add column email text check (email is null or email = lower(email));

-- The inline check on kind was named by postgres after the column.
alter table public.journey_step_events
  drop constraint journey_step_events_kind_check;

alter table public.journey_step_events
  add constraint journey_step_events_kind_check check (
    kind in (
      'enrolled',
      'sent',
      'skipped',
      'deferred',
      'exited',
      'completed',
      'moved',
      'restarted',
      'not-enrolled'
    )
  );

-- The Performance tab counts a journey's not-enrolled (and skipped) rows in a
-- window and the People tab lists the newest not-enrolled ones. The existing
-- index is by enrollment, which these rows don't have.
create index journey_step_events_journey_kind_idx
  on public.journey_step_events (journey_id, kind, created_at);
