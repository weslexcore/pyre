-- Daily-grain business metrics for /admin/business.
--
-- business_metrics_weekly stored the series pre-aggregated by Monday-start ET
-- week, which locked the dashboard into weekly grouping. The dashboard now
-- supports arbitrary date ranges grouped by day, week, or month, so the sync
-- jobs write one value per (ET calendar day, metric) here instead and the API
-- aggregates at read time. Same layer split as before:
--
--   momence_report_snapshots  raw report-run results (unchanged)
--   business_metrics_daily    the normalized series /admin/business reads
--
-- Metric keys: flow metrics sum over a day ('revenue_total', 'new_members',
-- 'attendance', 'no_shows'); 'session_capacity' and 'session_booked' are the
-- occupancy numerator/denominator, kept raw so any grouping computes the true
-- booked/capacity ratio instead of averaging percentages; 'active_members' is
-- a point-in-time stock (latest value at or before a date wins).
--
-- business_metrics_weekly stays in place but is no longer written or read —
-- history is regenerated at daily grain by the business-backfill endpoint,
-- except active_members (a stock with no history behind it), whose weekly
-- values are carried over below.

create table public.business_metrics_daily (
  -- ET calendar day, matching @pyre/schedule-core utcToEastern
  metric_date date not null,
  metric text not null,
  value numeric not null,
  -- which Momence source produced this value (report type or 'HOST_API')
  source_report_type text not null,
  -- provenance: snapshot_date of the last sync that wrote this row
  snapshot_date date not null,
  updated_at timestamptz not null default now(),
  primary key (metric_date, metric)
);

-- Series reads: one metric across days, newest first.
create index business_metrics_daily_metric_idx
  on public.business_metrics_daily (metric, metric_date desc);

create trigger business_metrics_daily_set_updated_at
  before update on public.business_metrics_daily
  for each row execute function public.set_updated_at();

alter table public.business_metrics_daily enable row level security;

-- App access is service-role (bypasses RLS); this policy is forward-looking
-- convention, same as business_metrics_weekly. Financials, so admin-only.
create policy "admins can select daily business metrics"
  on public.business_metrics_daily for select
  to authenticated
  using (public.is_admin());

-- Carry over active_members history: it is a stock sampled at sync time, so
-- the weekly rows are real observations (as of their week) that a backfill
-- cannot reconstruct. Each lands on its week's Monday; daily syncs overwrite
-- from here on. Flow metrics are NOT carried over — a week's sum placed on
-- one day would read as a spike in day view; the backfill regenerates them
-- at true daily grain instead.
insert into public.business_metrics_daily
  (metric_date, metric, value, source_report_type, snapshot_date)
select week_start, metric, value, source_report_type, snapshot_date
from public.business_metrics_weekly
where metric = 'active_members'
on conflict (metric_date, metric) do nothing;
