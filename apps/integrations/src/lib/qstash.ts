// The QStash side of every background worker call (cron tick, classify,
// suggest). One place builds the client and the headers the worker checks,
// so no dispatcher can forget the preview-deploy bypass. Server-only.

import type { Client } from '@upstash/qstash';

/**
 * What every worker message carries: the cron secret, forwarded as the
 * Authorization the worker checks with isCronAuthorized, and — on preview
 * deployments behind Vercel Deployment Protection, which would 401 QStash at
 * the edge — the automation bypass Vercel sets when "Protection Bypass for
 * Automation" is on.
 */
export function workerHeaders(secret: string): Record<string, string> {
  const bypass = import.meta.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return {
    Authorization: `Bearer ${secret}`,
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  };
}

export interface WorkerQueue {
  client: Client;
  headers: Record<string, string>;
}

/**
 * A QStash client plus the worker headers, or null when QStash or the cron
 * secret is unconfigured (callers fall back to running inline). The SDK is
 * imported lazily so a cold start only pays for it when something is queued.
 */
export async function workerQueue(): Promise<WorkerQueue | null> {
  const token = import.meta.env.QSTASH_TOKEN;
  const secret = import.meta.env.CRON_SECRET;
  if (!token || !secret) return null;
  const { Client } = await import('@upstash/qstash');
  return { client: new Client({ token }), headers: workerHeaders(secret) };
}
