// How one journey is doing over the last 7 / 30 / 90 days: people entering,
// finishing and leaving (and why), and each step's emails — sent, delivered,
// opened, clicked, bounced — plus how often each step was skipped and why.
// The website side (visits, bookings, purchases) comes from the journey's
// linked campaign in the shared campaign performance report; the Performance
// tab shows both.

import type { APIRoute } from 'astro';
import type { JourneyPerformanceResponse, StepPerformance } from '@/lib/email/journeys/api-types';
import { describeReason } from '@/lib/email/journeys/reasons';
import { getJourneyRow, toRecord } from '@/lib/email/journeys/store';
import { beginRead, json, storeError } from '@/lib/http/route';

export const prerender = false;

const ALLOWED_DAYS = [7, 30, 90];
const ROW_LIMIT = 50_000;

function topReasons(counts: Map<string, number>, limit = 5) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }));
}

export const GET: APIRoute = async ({ cookies, params, url }) => {
  const ready = await beginRead(cookies, '/admin/journeys');
  if (ready instanceof Response) return ready;

  const daysRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const days = ALLOWED_DAYS.includes(daysRaw) ? daysRaw : 30;
  const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();

  try {
    const row = await getJourneyRow(params.id ?? '');
    if (!row) return json({ error: 'Journey not found' }, 404);
    const definition = toRecord(row).record?.definition;
    const id = row.id;

    const [entered, ended, active, sends, events, firstEvent] = await Promise.all([
      ready.db
        .from('journey_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('journey_id', id)
        .gte('enrolled_at', since),
      ready.db
        .from('journey_enrollments')
        .select('status, exit_reason')
        .eq('journey_id', id)
        .neq('status', 'active')
        .gte('ended_at', since)
        .limit(ROW_LIMIT),
      ready.db
        .from('journey_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('journey_id', id)
        .eq('status', 'active'),
      ready.db
        .from('email_sends')
        .select('step_id, delivered_at, opened_at, clicked_at, bounced_at')
        .eq('journey_id', id)
        .eq('status', 'sent')
        .gte('sent_at', since)
        .limit(ROW_LIMIT),
      ready.db
        .from('journey_step_events')
        .select('step_key, detail')
        .eq('journey_id', id)
        .eq('kind', 'skipped')
        .gte('created_at', since)
        .limit(ROW_LIMIT),
      ready.db
        .from('journey_step_events')
        .select('created_at')
        .eq('journey_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    for (const res of [entered, ended, active, sends, events, firstEvent]) {
      if (res.error) throw new Error(res.error.message);
    }

    let finished = 0;
    let left = 0;
    const leaveCounts = new Map<string, number>();
    for (const e of (ended.data ?? []) as { status: string; exit_reason: string | null }[]) {
      if (e.status === 'completed') {
        finished += 1;
      } else {
        left += 1;
        // Group "removed by <who>" etc. under one heading.
        const code = (e.exit_reason ?? 'unknown').replace(
          /^(removed-by|restarted-by):.*/,
          '$1:someone'
        );
        const reason = describeReason(code).replace(/ someone$/, ' hand');
        leaveCounts.set(reason, (leaveCounts.get(reason) ?? 0) + 1);
      }
    }

    const byStep = new Map<string, StepPerformance>();
    const stepFor = (key: string): StepPerformance => {
      let s = byStep.get(key);
      if (!s) {
        const def = definition?.steps.find((st) => st.key === key);
        s = {
          key,
          name: def?.name || key,
          archived: def?.archived ?? true,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          skipped: 0,
          skipReasons: [],
        };
        byStep.set(key, s);
      }
      return s;
    };
    // Every current step appears, in journey order, even with no activity yet.
    for (const st of definition?.steps ?? []) stepFor(st.key);

    const totals = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
    for (const send of (sends.data ?? []) as {
      step_id: string | null;
      delivered_at: string | null;
      opened_at: string | null;
      clicked_at: string | null;
      bounced_at: string | null;
    }[]) {
      const s = stepFor(send.step_id ?? 'unknown');
      s.sent += 1;
      totals.sent += 1;
      if (send.delivered_at) {
        s.delivered += 1;
        totals.delivered += 1;
      }
      if (send.opened_at) {
        s.opened += 1;
        totals.opened += 1;
      }
      if (send.clicked_at) {
        s.clicked += 1;
        totals.clicked += 1;
      }
      if (send.bounced_at) {
        s.bounced += 1;
        totals.bounced += 1;
      }
    }

    const skipCounts = new Map<string, Map<string, number>>();
    for (const e of (events.data ?? []) as { step_key: string | null; detail: string | null }[]) {
      if (!e.step_key) continue;
      const s = stepFor(e.step_key);
      // A sent-but-not-delivered outcome ("suppressed:...") is logged as skipped too.
      s.skipped += 1;
      const reasons = skipCounts.get(e.step_key) ?? new Map<string, number>();
      const reason = describeReason(e.detail);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      skipCounts.set(e.step_key, reasons);
    }
    for (const [key, reasons] of skipCounts) stepFor(key).skipReasons = topReasons(reasons, 3);

    const body: JourneyPerformanceResponse = {
      days,
      entered: entered.count ?? 0,
      finished,
      left,
      active: active.count ?? 0,
      leaveReasons: topReasons(leaveCounts),
      totals,
      steps: [...byStep.values()],
      stepLogSince: (firstEvent.data as { created_at: string } | null)?.created_at ?? null,
    };
    return json(body);
  } catch (e) {
    return storeError('Journeys', e);
  }
};
