import { createWebhookLogger, getRedis } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type JourneyEnrollmentRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import {
  assignMemberTag,
  fetchHostMember,
  fetchMemberActivePacks,
  fetchMembersFiltered,
  getTagIdByName,
  type HostMember,
} from '@/lib/momence/host-api';
import type { TriggerEvent } from '@/lib/triggers/dispatch';
import { JOURNEYS } from './registry';
import type { Journey, JourneyContext } from './types';

const log = createWebhookLogger('Journeys');

// The journey engine. Three entry points:
//   enrollFromEvent()      — called by the trigger bus (webhook / sales poller)
//   runEnrollmentSweeps()  — hourly cron job discovering sweep-journey audiences
//   advanceDueJourneys()   — hourly cron job sending due steps
// State lives in Supabase journey_enrollments (unique per journey+member, rows
// never deleted); send dedupe rides email_sends.send_key inside sendTemplate.

// --- Timing ---

function isFastMode(): boolean {
  return import.meta.env.JOURNEY_FAST_MODE === 'true';
}

function delayToMs(delayHours: number): number {
  // Fast mode: hours become minutes so a whitelist test walks a multi-day
  // journey in minutes.
  return isFastMode() ? delayHours * 60_000 : delayHours * 3_600_000;
}

function nextAtForStep(journey: Journey, stepIndex: number, fromMs: number): string | null {
  const step = journey.steps[stepIndex];
  if (!step) return null;
  return new Date(fromMs + delayToMs(step.delayHours)).toISOString();
}

// --- Context ---

interface MemberIdentity {
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
}

function buildContext(identity: MemberIdentity, preloaded?: HostMember): JourneyContext {
  let memberPromise: Promise<HostMember> | null = preloaded ? Promise.resolve(preloaded) : null;
  let packsPromise: ReturnType<typeof fetchMemberActivePacks> | null = null;

  return {
    ...identity,
    member() {
      memberPromise ??= fetchHostMember(identity.memberId);
      return memberPromise;
    },
    activePacks() {
      packsPromise ??= fetchMemberActivePacks(identity.memberId);
      return packsPromise;
    },
  };
}

// --- Enrollment ---

export type EnrollOutcome = 'enrolled' | 'already-enrolled' | 'unavailable';

export async function enrollMember(
  journey: Journey,
  identity: MemberIdentity,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<EnrollOutcome> {
  const db = getDb();
  if (!db) return 'unavailable';

  if (dryRun) {
    const { data } = await db
      .from('journey_enrollments')
      .select('id')
      .eq('journey_id', journey.id)
      .eq('member_id', identity.memberId)
      .maybeSingle();
    return data ? 'already-enrolled' : 'enrolled';
  }

  // The unique constraint is the guard: completed/exited rows persist forever,
  // so once-per-lifetime journeys can never re-enroll a member.
  const { data, error } = await db
    .from('journey_enrollments')
    .upsert(
      {
        journey_id: journey.id,
        member_id: identity.memberId,
        email: identity.email.toLowerCase(),
        step: 0,
        next_at: nextAtForStep(journey, 0, Date.now()),
        status: 'active',
      },
      { onConflict: 'journey_id,member_id', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle();

  if (error) {
    log.error(`Enroll failed: ${journey.id} member ${identity.memberId}: ${error.message}`);
    return 'unavailable';
  }
  if (!data) return 'already-enrolled';

  log.info(`Enrolled member ${identity.memberId} into ${journey.id}`);
  await captureEvent({
    distinctId: identity.email.toLowerCase(),
    event: 'journey_enrolled',
    properties: { journey: journey.id },
  });
  return 'enrolled';
}

export async function enrollFromEvent(event: TriggerEvent): Promise<void> {
  for (const journey of JOURNEYS) {
    if (journey.enroll.source !== 'event') continue;
    if (!journey.enroll.events.includes(event.type)) continue;

    const ctx = buildContext(event);
    try {
      if (await journey.enroll.when(event, ctx)) {
        await enrollMember(journey, event);
      }
    } catch (error) {
      log.warn(`Event enrollment check failed for ${journey.id}`, error);
    }
  }
}

// --- Sweep enrollment (cron job) ---

const SWEEP_CURSOR_PREFIX = 'sweep:journey:';
const SWEEP_PAGE_SIZE = 100;
// Leave enough budget for advanceDueJourneys to run after the sweeps.
const SWEEP_MIN_REMAINING_MS = 20_000;

export async function runEnrollmentSweeps(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const summary: Record<string, unknown> = {};

  for (const journey of JOURNEYS) {
    if (journey.enroll.source !== 'sweep') continue;
    if (ctx.timeRemainingMs() < SWEEP_MIN_REMAINING_MS) {
      summary[journey.id] = { skipped: 'out-of-time' };
      continue;
    }

    const cursorKey = `${SWEEP_CURSOR_PREFIX}${journey.id}:cursor`;
    let page = 0;
    if (redis) {
      const cursor = await redis.get<number>(cursorKey);
      if (typeof cursor === 'number') page = cursor;
    }

    const audience = await journey.enroll.audience();
    let scanned = 0;
    let enrolled = 0;
    let wrapped = false;

    while (ctx.timeRemainingMs() >= SWEEP_MIN_REMAINING_MS) {
      const { members } = await fetchMembersFiltered({
        page,
        pageSize: SWEEP_PAGE_SIZE,
        filter: audience.filter,
        filterPreset: audience.filterPreset,
      });
      scanned += members.length;

      for (const member of members) {
        const identity = {
          memberId: member.id,
          email: member.email,
          firstName: member.firstName,
          lastName: member.lastName,
        };
        try {
          if (audience.predicate) {
            const memberCtx = buildContext(identity, member);
            if (!(await audience.predicate(member, memberCtx))) continue;
          }
          const outcome = await enrollMember(journey, identity, { dryRun: ctx.dryRun });
          if (outcome === 'enrolled') enrolled += 1;
        } catch (error) {
          log.warn(`Sweep predicate/enroll failed for ${journey.id} member ${member.id}`, error);
        }
      }

      if (members.length < SWEEP_PAGE_SIZE) {
        // End of the audience — next tick starts over (enrollment is
        // idempotent, so rescanning is cheap and catches new matches).
        page = 0;
        wrapped = true;
        break;
      }
      page += 1;
    }

    if (redis && !ctx.dryRun) {
      await redis.set(cursorKey, page);
    }

    summary[journey.id] = { scanned, enrolled, resumePage: wrapped ? 0 : page };
  }

  return summary;
}

// --- Step advancement (cron job) ---

const ADVANCE_BATCH_SIZE = 50;
const ADVANCE_MIN_REMAINING_MS = 5_000;

export async function advanceDueJourneys(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const db = getDb();
  if (!db) return { skipped: 'supabase-not-configured' };

  const { data: due, error } = await db
    .from('journey_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_at', new Date().toISOString())
    .order('next_at', { ascending: true })
    .limit(ADVANCE_BATCH_SIZE);

  if (error) {
    log.error(`Could not load due enrollments: ${error.message}`);
    return { error: error.message };
  }

  let sent = 0;
  let skippedSteps = 0;
  let exited = 0;
  let completed = 0;
  const wouldSend: string[] = [];

  for (const row of (due ?? []) as JourneyEnrollmentRow[]) {
    if (ctx.timeRemainingMs() < ADVANCE_MIN_REMAINING_MS) break;

    const journey = JOURNEYS.find((j) => j.id === row.journey_id);
    if (!journey) {
      await transition(row, { status: 'exited', exit_reason: 'journey-removed' });
      exited += 1;
      continue;
    }

    const step = journey.steps[row.step];
    if (!step) {
      await completeJourney(journey, row);
      completed += 1;
      continue;
    }

    try {
      // The row only stores id + email; pull the live member once per row so
      // exit checks, skip checks, and template props all share it.
      const member = await fetchHostMember(row.member_id);
      const memberCtx = buildContext(
        {
          memberId: row.member_id,
          email: row.email,
          firstName: member.firstName,
          lastName: member.lastName,
        },
        member
      );

      // Live re-check against Momence — the whole point of keeping state thin.
      const exitReason = journey.exitWhen ? await journey.exitWhen(memberCtx) : null;
      if (exitReason) {
        if (!ctx.dryRun) {
          await transition(row, { status: 'exited', exit_reason: exitReason });
          await captureEvent({
            distinctId: row.email,
            event: 'journey_exited',
            properties: { journey: journey.id, step: step.id, reason: exitReason },
          });
        }
        exited += 1;
        continue;
      }

      if (step.skipIf && (await step.skipIf(memberCtx))) {
        if (!ctx.dryRun) await advance(journey, row);
        skippedSteps += 1;
        continue;
      }

      if (ctx.dryRun) {
        wouldSend.push(`${journey.id}/${step.id} -> ${row.email}`);
        continue;
      }

      const props = await step.props(memberCtx);
      const result = await sendTemplate({
        to: row.email,
        template: step.template,
        // defineStep() guarantees the template/props pairing per step; the
        // heterogeneous steps array erases it for the compiler.
        props: props as never,
        kind: journey.kind,
        sendKey: `journey:${journey.id}:${row.member_id}:${step.id}`,
        memberId: row.member_id,
        journeyId: journey.id,
        stepId: step.id,
      });

      if (result.status === 'suppressed' && result.reason === 'unsubscribed') {
        await transition(row, { status: 'exited', exit_reason: 'unsubscribed' });
        exited += 1;
        continue;
      }

      if (result.status === 'sent') {
        sent += 1;
        await captureEvent({
          distinctId: row.email,
          event: 'journey_email_sent',
          properties: { journey: journey.id, step: step.id, template: step.template },
        });
      }

      // 'sent', 'already-sent', and dev-mode suppression all advance — the
      // step is done either way.
      await advance(journey, row);
    } catch (error) {
      // Leave the row as-is; next tick retries (send dedupe makes that safe).
      log.warn(`Advance failed for ${row.journey_id} member ${row.member_id}`, error);
    }
  }

  return {
    due: due?.length ?? 0,
    sent,
    skippedSteps,
    exited,
    completed,
    ...(ctx.dryRun && { wouldSend }),
  };
}

async function advance(journey: Journey, row: JourneyEnrollmentRow): Promise<void> {
  const nextIndex = row.step + 1;
  if (journey.steps[nextIndex]) {
    await transition(row, {
      step: nextIndex,
      next_at: nextAtForStep(journey, nextIndex, Date.now()),
    });
  } else {
    await completeJourney(journey, row);
  }
}

async function completeJourney(journey: Journey, row: JourneyEnrollmentRow): Promise<void> {
  await transition(row, { status: 'completed', next_at: null });
  await captureEvent({
    distinctId: row.email,
    event: 'journey_completed',
    properties: { journey: journey.id },
  });

  if (journey.completionTag) {
    try {
      const tagId = await getTagIdByName(journey.completionTag);
      if (tagId) {
        await assignMemberTag(row.member_id, tagId);
      } else {
        log.warn(
          `Completion tag "${journey.completionTag}" not found in Momence — create it in the dashboard`
        );
      }
    } catch (error) {
      log.warn(`Could not write completion tag for ${journey.id}`, error);
    }
  }
}

async function transition(
  row: JourneyEnrollmentRow,
  patch: Partial<Pick<JourneyEnrollmentRow, 'step' | 'next_at' | 'status' | 'exit_reason'>>
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db.from('journey_enrollments').update(patch).eq('id', row.id);
  if (error) {
    log.error(`Enrollment update failed for ${row.id}: ${error.message}`);
  }
}
