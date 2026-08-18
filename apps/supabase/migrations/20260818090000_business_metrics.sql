-- Business-overview metrics pulled from the Momence Reports API by the daily
-- business-report-sync cron job in apps/integrations. Two layers:
--
--   momence_report_snapshots  raw report-run results, one row per report type
--                             per day. Momence documents the report-run
--                             envelope but not the per-type item shapes, so
--                             the raw items are kept verbatim — normalization
--                             can be re-run from here without re-spending the
--                             API's 100-report-runs/day budget.
--
--   business_metrics_weekly   the normalized series the /admin/business
--                             dashboard actually reads: one value per
--                             (Monday-start ET week, metric). Flow metrics
--                             (revenue, attendance, new members) sum over the
--                             week; stock metrics (active members) hold the
--                             value as of the latest snapshot covering it.

create table public.momence_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  -- Momence reportType enum value, e.g. 'TOTAL_SALES', 'ATTENDANCE'
  report_type text not null,
  -- ET calendar day the run was created; one snapshot per type per day
  snapshot_date date not null,
  -- the dateRange the run was created with (trailing window, self-healing)
  range_from date not null,
  range_to date not null,
  -- Momence's report-run id, for tracing a row back to the API
  report_run_id bigint,
  -- data.items verbatim (possibly truncated — see normalize_status)
  raw_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(raw_items) = 'array'),
  item_count integer not null default 0,
  -- normalization outcome, for triage from the dashboard:
  -- 'ok' = every item parsed; 'empty' = report returned no items;
  -- 'parse-partial' = some items unparseable or raw_items truncated
  normalize_status text not null default 'ok'
    check (normalize_status in ('ok', 'empty', 'parse-partial')),
  created_at timestamptz not null default now(),
  -- daily re-runs upsert in place rather than piling up duplicates
  unique (report_type, snapshot_date)
);

-- Dashboard freshness check reads the latest snapshot per type.
create index momence_report_snapshots_type_date_idx
  on public.momence_report_snapshots (report_type, snapshot_date desc);

create table public.business_metrics_weekly (
  -- Monday-start ET week, matching @pyre/schedule-core weekStartOf
  week_start date not null,
  -- normalized metric key: 'revenue_total', 'new_members',
  -- 'membership_cancellations', 'active_members', 'attendance', 'no_shows',
  -- 'occupancy_pct'
  metric text not null,
  value numeric not null,
  -- which Momence report produced this value
  source_report_type text not null,
  -- provenance: snapshot_date of the last snapshot that wrote this row
  snapshot_date date not null,
  updated_at timestamptz not null default now(),
  primary key (week_start, metric)
);

-- Series reads: one metric across weeks, newest first.
create index business_metrics_weekly_metric_idx
  on public.business_metrics_weekly (metric, week_start desc);

create trigger business_metrics_weekly_set_updated_at
  before update on public.business_metrics_weekly
  for each row execute function public.set_updated_at();

alter table public.momence_report_snapshots enable row level security;
alter table public.business_metrics_weekly enable row level security;

-- App access is service-role (bypasses RLS); these policies are
-- forward-looking convention, same as the other tables. Financials, so
-- admin-only like the staff pay columns.
create policy "admins can select report snapshots"
  on public.momence_report_snapshots for select
  to authenticated
  using (public.is_admin());

create policy "admins can select business metrics"
  on public.business_metrics_weekly for select
  to authenticated
  using (public.is_admin());
