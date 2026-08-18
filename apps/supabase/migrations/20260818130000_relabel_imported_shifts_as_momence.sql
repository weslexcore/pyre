-- Relabel the sheet-imported shifts from 'manual' to 'momence'.
--
-- The one-off import (20260804150001_staff_scheduling_import.sql) inserted the
-- historical schedule with source = 'manual', but every one of those shifts was
-- customer-facing session coverage from the staffing sheet — not maintenance
-- work. openHoursByWeek() counts customer-facing (open) hours only for
-- momence-sourced shifts, so the imported history contributed labor cost with
-- zero open hours and blew up the cost-per-open-hour metric on
-- /admin/schedule/insights and /admin/business.
--
-- Safe to relabel: the momence sync only ever queries shifts from "now"
-- forward, and every imported shift date (2026-07-08 through 2026-08-16) is in
-- the past, so the sync will never touch these rows despite their empty
-- momence_session_ids.
--
-- Scoping: the import was the very first insert into shifts (it ran in the
-- migration immediately after the table was created), and a single insert
-- statement stamps every row with the identical created_at. Matching on
-- min(created_at) therefore selects exactly the imported batch — admin-created
-- manual shifts all came later and keep their 'manual' label (that label means
-- maintenance/non-revenue work going forward).
update public.shifts
set source = 'momence'
where source = 'manual'
  and created_at = (select min(created_at) from public.shifts);
