// Who is in a journey: GET lists enrollments (newest first, filterable by
// status and email) with each person's sends from this journey; POST enrolls
// someone by email or takes someone out.

import type { APIRoute } from 'astro';
import type { EmailSendRow, JourneyEnrollmentRow } from '@/lib/db';
import type { EnrollmentDto, EnrollmentsResponse } from '@/lib/email/journeys/api-types';
import { enrollManually, exitJourney } from '@/lib/email/journeys/engine';
import { getJourneyRow, toRecord } from '@/lib/email/journeys/store';
import { beginMutation, beginRead, json, storeError } from '@/lib/http/route';

export const prerender = false;

const PAGE = '/admin/journeys';
const LIMIT = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OUTCOME_MESSAGES: Record<string, string> = {
  enrolled: 'Enrolled.',
  'already-enrolled': 'Already in this journey right now.',
  'cooling-down': 'Finished this journey too recently to re-enter it yet.',
  'not-whitelisted': 'The journey is in test mode and this address is not on the whitelist.',
  'no-steps': 'The journey has no steps to run.',
  unavailable: 'Storage unavailable — try again.',
  'not-found': 'That customer could not be found in Momence (or has no email).',
};

export const GET: APIRoute = async ({ cookies, params, url }) => {
  const ready = await beginRead(cookies, PAGE);
  if (ready instanceof Response) return ready;
  const journeyId = params.id ?? '';
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q')?.trim().toLowerCase();

  try {
    let query = ready.db
      .from('journey_enrollments')
      .select('*')
      .eq('journey_id', journeyId)
      .order('enrolled_at', { ascending: false })
      .limit(LIMIT + 1);
    if (status === 'active' || status === 'completed' || status === 'exited') {
      query = query.eq('status', status);
    }
    if (q) query = query.ilike('email', `%${q.replace(/[%_]/g, '')}%`);

    const [rowsRes, countsRes] = await Promise.all([
      query,
      ready.db
        .from('journey_enrollments')
        .select('status')
        .eq('journey_id', journeyId)
        .limit(50_000),
    ]);
    if (rowsRes.error) throw new Error(rowsRes.error.message);
    if (countsRes.error) throw new Error(countsRes.error.message);

    const rows = (rowsRes.data as JourneyEnrollmentRow[]).slice(0, LIMIT);
    const memberIds = [...new Set(rows.map((r) => r.member_id))];
    const sendsByMember = new Map<number, EmailSendRow[]>();
    if (memberIds.length > 0) {
      const { data, error } = await ready.db
        .from('email_sends')
        .select('*')
        .eq('journey_id', journeyId)
        .in('member_id', memberIds)
        .order('sent_at', { ascending: true })
        .limit(5_000);
      if (error) throw new Error(error.message);
      for (const send of data as EmailSendRow[]) {
        if (send.member_id === null) continue;
        const list = sendsByMember.get(send.member_id) ?? [];
        list.push(send);
        sendsByMember.set(send.member_id, list);
      }
    }

    const counts = { active: 0, completed: 0, exited: 0 };
    for (const r of countsRes.data as { status: keyof typeof counts }[]) counts[r.status] += 1;

    const enrollments: EnrollmentDto[] = rows.map((r) => {
      // A re-entered member's sends belong to the run they happened in.
      const runStart = Date.parse(r.enrolled_at);
      const runEnd = r.ended_at ? Date.parse(r.ended_at) + 60_000 : Number.POSITIVE_INFINITY;
      return {
        id: r.id,
        memberId: r.member_id,
        email: r.email,
        status: r.status,
        cycle: r.cycle,
        currentStepKey: r.current_step_key,
        nextAt: r.next_at,
        exitReason: r.exit_reason,
        enrolledAt: r.enrolled_at,
        endedAt: r.ended_at,
        sends: (sendsByMember.get(r.member_id) ?? [])
          .filter((s) => {
            const at = Date.parse(s.sent_at);
            return at >= runStart - 60_000 && at <= runEnd;
          })
          .map((s) => ({
            stepId: s.step_id,
            subject: s.subject,
            status: s.status,
            sentAt: s.sent_at,
            deliveredAt: s.delivered_at,
            openedAt: s.opened_at,
            clickedAt: s.clicked_at,
            bouncedAt: s.bounced_at,
            error: s.error,
          })),
      };
    });

    const body: EnrollmentsResponse = {
      enrollments,
      counts,
      truncated: (rowsRes.data as unknown[]).length > LIMIT,
    };
    return json(body);
  } catch (e) {
    return storeError('Journeys', e);
  }
};

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  const { action, email, memberId, enrollmentId } = ready.body as {
    action?: unknown;
    email?: unknown;
    memberId?: unknown;
    enrollmentId?: unknown;
  };

  const row = await getJourneyRow(params.id ?? '');
  if (!row) return json({ error: 'Journey not found' }, 404);
  const record = toRecord(row).record;
  if (!record) return json({ error: 'This journey has an invalid definition — fix it first' }, 409);

  if (action === 'enroll') {
    // By Momence member id (picked from the customer search) or by email.
    // Manual adds skip the journey's re-entry rule: someone who already went
    // through it starts a fresh run.
    let who: { memberId: number } | { email: string };
    if (typeof memberId === 'number' && Number.isInteger(memberId)) {
      who = { memberId };
    } else {
      const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(address))
        return json({ error: 'Pick a customer or enter a valid email' }, 400);
      who = { email: address };
    }
    const result = await enrollManually(record, who);
    const base = OUTCOME_MESSAGES[result.outcome] ?? result.outcome;
    const message = result.outcome === 'enrolled' && result.email ? `Added ${result.email}.` : base;
    return json({ outcome: result.outcome, message }, result.outcome === 'enrolled' ? 200 : 409);
  }

  if (action === 'exit') {
    if (typeof enrollmentId !== 'string') return json({ error: 'enrollmentId is required' }, 400);
    const { data, error } = await ready.db
      .from('journey_enrollments')
      .select('id, email, member_id, status, current_step_key')
      .eq('id', enrollmentId)
      .eq('journey_id', record.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 503);
    if (!data) return json({ error: 'Enrollment not found' }, 404);
    if (data.status !== 'active') return json({ error: 'They are no longer in this journey' }, 409);
    await exitJourney(
      record,
      data,
      `removed-by:${ready.email}`,
      data.current_step_key ?? undefined
    );
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
};
