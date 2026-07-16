-- Add an error column to the email send log so failed sends are observable.
--
-- Until now a failed Resend call only released its dedupe claim and logged to
-- the function console — nothing durable recorded that the send failed or why.
-- The integrations admin dashboard (/admin) surfaces failed sends from this
-- table, so the send pipeline now inserts a status='failed' row (without a
-- send_key, so retries are not blocked) carrying the error message here.

-- nullable: only populated on status='failed' rows
alter table public.email_sends
  add column if not exists error text;

comment on column public.email_sends.error is
  'Error message captured when a send attempt failed (status = failed). Null for successful/skipped/suppressed rows.';

-- "What has been failing lately?" — the dashboard's error feed.
create index if not exists email_sends_failed_idx
  on public.email_sends (sent_at desc)
  where status = 'failed';
