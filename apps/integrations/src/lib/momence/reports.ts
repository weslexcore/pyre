// Momence Reports API — async report runs (create, then poll until
// completed). Used by the daily business-report-sync cron job; nothing here
// is called on a request path.
//
// Rate limits (per Momence docs): 100 report creations/day, 1000 result
// GETs/day. The daily job creates one run per DAILY_REPORTS type over a
// trailing window, so creation stays an order of magnitude under budget —
// but nothing outside the cron/backfill paths should ever create runs.
//
// Docs: https://api.docs.momence.com/ (report-run controller). The run
// envelope is documented; per-type item shapes are NOT — treat data.items as
// unknown[] and normalize defensively (see lib/reports/normalize.ts).

import { MomenceApiError, momenceRequest } from '@/lib/momence/host-api';

/** The report types the daily sync pulls. Unverified against the live enum —
 * a type Momence rejects surfaces as ReportUnavailableError and degrades
 * per-metric, not per-page. */
export type MomenceReportType =
  | 'TOTAL_SALES'
  | 'REVENUE_BREAKDOWN'
  | 'ACTIVE_MEMBERS'
  | 'NEW_MEMBERS'
  | 'MEMBERSHIP_CANCELLATIONS'
  | 'ATTENDANCE'
  | 'SESSION_OCCUPANCY'
  | 'NO_SHOWS';

export interface ReportRunResult {
  id: number;
  status: 'running' | 'completed';
  /** null until status is 'completed' */
  data: { reportType: string; items: unknown[] } | null;
}

/**
 * Momence rejected the report request outright (bad type name, not on the
 * plan, or the token lacks report scope) — distinct from a transient failure,
 * so the sync job records the type as unavailable instead of retrying it.
 */
export class ReportUnavailableError extends Error {
  constructor(
    public readonly reportType: MomenceReportType,
    public readonly status: number
  ) {
    super(`Momence report ${reportType} unavailable (status ${status})`);
    this.name = 'ReportUnavailableError';
  }
}

function hostId(): number {
  const id = Number(import.meta.env.MOMENCE_HOST_ID);
  if (!Number.isFinite(id)) {
    throw new Error('MOMENCE_HOST_ID is not set (required for report runs)');
  }
  return id;
}

/** Create a report run over [from, to] (YYYY-MM-DD); returns the run id. */
export async function createReportRun(params: {
  reportType: MomenceReportType;
  from: string;
  to: string;
}): Promise<number> {
  try {
    const data = await momenceRequest<{ id: number }>('POST', '/host/reports', {
      body: {
        parameters: {
          reportType: params.reportType,
          hostId: hostId(),
          dateRange: { from: params.from, to: params.to },
        },
      },
    });
    return data.id;
  } catch (error) {
    if (error instanceof MomenceApiError && [400, 403, 404].includes(error.status)) {
      throw new ReportUnavailableError(params.reportType, error.status);
    }
    throw error;
  }
}

/** Fetch a run's status/result; data stays null while status is 'running'. */
export async function getReportRun(runId: number): Promise<ReportRunResult> {
  return momenceRequest<ReportRunResult>('GET', `/host/reports/${runId}`);
}
