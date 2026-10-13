import { createWebhookLogger, getRedis } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type JourneyEnrollmentRow } from '@/lib/db';
import { type EmailGate, getEmailGate } from '@/lib/email/dev-mode';
import { sendTemplate } from '@/lib/email/send';
import {
  assignMemberTag,
  fetchHostMember,
  fetchMembersFiltered,
  findMemberByEmail,
  getTagIdByName,
  type HostMember,
  type MemberListFilter,
  removeMemberTag,
} from '@/lib/momence/host-api';
import { isMemberFirstBooking } from '@/lib/momence/members';
import type { BookingTriggerEvent, TriggerEvent } from '@/lib/triggers/dispatch';
import {
  allMatch,
  buildContext,
  type EnrollmentContext,
  firstMatch,
  type JourneyContext,
  type MemberIdentity,
  mergeValues,
  resolveIntroExpiry,
} from './context';
import { fillContent, usedFields } from './merge-fields';
import {
  type JourneyAction,
  type JourneyRecord,
  type JourneyStep,
  journeyCampaign,
  type Trigger,
} from './schema';
import { isTemplateStepKey, loadJourneys } from './store';
import {
  type AnchorTimes,
  clampToSendWindow,
  currentStepIndex,
  frequencyCapUntil,
  isStale,
  nextStepIndex,
  sendKeyFor,
  stepDueAt,
} from './timing';

const log = createWebhookLogger('Journeys');

// The journey engine. Journeys are rows in the journeys table (built in
// /admin/journeys, loaded through ./store). Three entry points:
//   enrollFromEvent()      — called by the trigger bus (Momence booking webhook)
//   runEnrollmentSweeps()  — hourly cron job finding audience-journey matches
//   advanceDueJourneys()   — hourly cron job running due steps
// Enrollment rows in journey_enrollments remember WHERE someone is (journey,
// waiting step, when it's due) and how they entered — never WHY. Exit, skip
// and enroll conditions re-read live Momence data right before each decision.
// Send dedupe rides email_sends.send_key inside sendTemplate.
//
// A switched-off journey neither enrolls nor advances: members mid-journey
// hold their step until it's switched back on. Test mode limits a journey to
// whitelisted addresses, end to end.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function isFastMode(): boolean {
  return import.meta.env.JOURNEY_FAST_MODE === 'true';
}

// --- Scheduling ---

/** When a step should run: its anchor + offset, kept inside the send window. */
function scheduleAt(step: JourneyStep, anchors: AnchorTimes, now: number): string {
  const fastMode = isFastMode();
  // Unknown anchor (no intro offer): due now, and the due-time check skips it.
  const due = stepDueAt(step.timing, anchors, { fastMode }) ?? now;
  const at = Math.max(due, now);
  return new Date(fastMode ? at : clampToSendWindow(at)).toISOString();
}

function anchorsFor(
  row: Pick<JourneyEnrollmentRow, 'anchor_at' | 'enrolled_at' | 'last_step_at'>,
  introExpiresAt: number | null
): AnchorTimes {
  return {
    triggerAt: Date.parse(row.anchor_at ?? row.enrolled_at),
    previousAt: row.last_step_at ? Date.parse(row.last_step_at) : null,
    introExpiresAt,
  };
}

function usesIntroExpiry(journey: JourneyRecord): boolean {
  return journey.definition.steps.some((s) => s.timing.anchor === 'intro-expiry');
}

// --- Actions ---

async function runActions(actions: JourneyAction[], memberId: number): Promise<void> {
  for (const action of actions) {
    try {
      const tagId = await getTagIdByName(action.tag);
      if (!tagId) {
        log.warn(`Tag "${action.tag}" not found in Momence — create it in the dashboard`);
        continue;
      }
      if (action.type === 'add-tag') await assignMemberTag(memberId, tagId);
      else await removeMemberTag(memberId, tagId);
    } catch (error) {
      log.warn(`Action ${action.type} "${action.tag}" failed for member ${memberId}`, error);
    }
  }
}

// --- Enrollment ---

export type EnrollOutcome =
  | 'enrolled'
  | 'already-enrolled'
  | 'cooling-down'
  | 'not-whitelisted'
  | 'no-steps'
  | 'unavailable';

interface EnrollOptions {
  dryRun?: boolean;
  /** What step timing counts from; defaults to now. */
  anchorAt?: number;
  context?: EnrollmentContext;
  /** Live context, when the caller already built one (enrollIf checks). */
  ctx?: JourneyContext;
  gate?: EmailGate;
  /**
   * Added by hand from the People tab: the re-entry rule (once ever, or the
   * cooldown) doesn't apply — an admin adding someone means it. Being in the
   * journey right now still blocks a second run.
   */
  manual?: boolean;
}

export async function enrollMember(
  journey: JourneyRecord,
  identity: MemberIdentity,
  { dryRun = false, anchorAt, context = {}, ctx, gate, manual = false }: EnrollOptions = {}
): Promise<EnrollOutcome> {
  const db = getDb();
  if (!db) return 'unavailable';
  const email = identity.email.toLowerCase();

  if (journey.testMode && !(gate ?? (await getEmailGate())).isAllowed(email)) {
    return 'not-whitelisted';
  }

  const steps = journey.definition.steps;
  const first = nextStepIndex(steps, null);
  if (first === null) return 'no-steps';

  const { data: latest, error: latestError } = await db
    .from('journey_enrollments')
    .select('status, cycle, ended_at, updated_at')
    .eq('journey_id', journey.id)
    .eq('member_id', identity.memberId)
    .order('cycle', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    log.error(
      `Enroll lookup failed: ${journey.id} member ${identity.memberId}: ${latestError.message}`
    );
    return 'unavailable';
  }

  let cycle = 0;
  if (latest) {
    if (latest.status === 'active') return 'already-enrolled';
    const reentry = journey.definition.reentry;
    if (!manual) {
      if (reentry.mode === 'once') return 'already-enrolled';
      const endedAt = Date.parse(latest.ended_at ?? latest.updated_at);
      if (Date.now() - endedAt < reentry.days * DAY_MS) return 'cooling-down';
    }
    // A new run: its send keys carry the cycle, so its emails go out again.
    cycle = latest.cycle + 1;
  }

  if (dryRun) return 'enrolled';

  const now = Date.now();
  const anchor = anchorAt ?? now;
  let introExpiresAt: number | null = null;
  if (usesIntroExpiry(journey)) {
    const memberCtx = ctx ?? buildContext(identity, { enrollment: context });
    introExpiresAt = await resolveIntroExpiry(memberCtx).catch(() => null);
  }
  const fullContext: EnrollmentContext = {
    ...context,
    ...(introExpiresAt !== null && { introExpiresAt: new Date(introExpiresAt).toISOString() }),
  };

  const { error } = await db.from('journey_enrollments').insert({
    journey_id: journey.id,
    member_id: identity.memberId,
    email,
    cycle,
    step: 0,
    current_step_key: steps[first].key,
    next_at: scheduleAt(steps[first], { triggerAt: anchor, previousAt: null, introExpiresAt }, now),
    status: 'active',
    anchor_at: new Date(anchor).toISOString(),
    context: fullContext,
  });

  if (error) {
    // Unique violation: a concurrent delivery enrolled them first.
    if (error.code === '23505') return 'already-enrolled';
    log.error(`Enroll failed: ${journey.id} member ${identity.memberId}: ${error.message}`);
    return 'unavailable';
  }

  log.info(`Enrolled member ${identity.memberId} into ${journey.id} (cycle ${cycle})`);
  await captureEvent({
    distinctId: email,
    event: 'journey_enrolled',
    properties: { journey: journey.id, cycle },
  });
  return 'enrolled';
}

/** Enroll someone by email from the admin People tab. */
/** Add someone by hand from the People tab — by Momence member id, or by email. */
export async function enrollManually(
  journey: JourneyRecord,
  who: { memberId: number } | { email: string }
): Promise<{ outcome: EnrollOutcome | 'not-found'; memberId?: number; email?: string }> {
  let member: HostMember | null;
  try {
    member =
      'memberId' in who ? await fetchHostMember(who.memberId) : await findMemberByEmail(who.email);
  } catch {
    member = null;
  }
  if (!member) return { outcome: 'not-found' };
  if (!member.email) return { outcome: 'not-found' };
  const outcome = await enrollMember(
    journey,
    {
      memberId: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
    },
    { manual: true }
  );
  return { outcome, memberId: member.id, email: member.email };
}

function bookingContext(event: BookingTriggerEvent): EnrollmentContext {
  return {
    sessionId: event.sessionId,
    sessionBookingId: event.sessionBookingId,
    ...(event.sessionStartsAt && { sessionStartsAt: event.sessionStartsAt }),
    ...(event.sessionEndsAt && { sessionEndsAt: event.sessionEndsAt }),
  };
}

export async function enrollFromEvent(event: TriggerEvent): Promise<void> {
  if (event.type !== 'session-booked') return;

  const journeys = (await loadJourneys()).filter(
    (j) => j.enabled && j.definition.trigger.type === 'session-booked'
  );
  if (journeys.length === 0) return;

  const gate = await getEmailGate();
  const context = bookingContext(event);
  const anchorAt = event.sessionEndsAt ? Date.parse(event.sessionEndsAt) : Date.now();
  let firstBooking: Promise<boolean | null> | null = null;

  for (const journey of journeys) {
    const trigger = journey.definition.trigger as Extract<Trigger, { type: 'session-booked' }>;
    try {
      if (journey.testMode && !gate.isAllowed(event.email)) continue;
      if (trigger.firstBookingOnly) {
        firstBooking ??= isMemberFirstBooking(String(event.memberId), event.sessionBookingId);
        // Fails safe — null (unknown) means no enrollment.
        if ((await firstBooking) !== true) continue;
      }
      const ctx = buildContext(event, { enrollment: context });
      if (!(await allMatch(ctx, journey.definition.enrollIf))) continue;
      await enrollMember(journey, event, { anchorAt, context, ctx, gate });
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

interface SweepAudience {
  filter?: MemberListFilter;
  /** Code-level checks for what the Momence filter can't express. */
  matches(member: HostMember): boolean;
  /** A required tag doesn't exist in Momence, so nobody can match. */
  impossible?: string;
  /**
   * Last seen longer ago than the audience reaches. Members come sorted by
   * last visit, newest first, so once one is past the window everyone after
   * them is too and the scan can stop.
   */
  pastWindow(member: HostMember): boolean;
}

async function sweepAudience(trigger: Extract<Trigger, { type: 'sweep' }>): Promise<SweepAudience> {
  const withoutIds = (await Promise.all(trigger.withoutTags.map(getTagIdByName))).filter(
    (id): id is number => id !== null
  );
  const missingWith = [];
  for (const tag of trigger.withTags) {
    if ((await getTagIdByName(tag)) === null) missingWith.push(tag);
  }

  const filter: MemberListFilter = { type: 'and' };
  if (trigger.minVisits) {
    filter.visits = { count: { type: 'moreThan', value: trigger.minVisits - 1 } };
  }
  if (withoutIds.length > 0) {
    filter.customerTags = { type: 'and', customerHaveTag: 'not-have', tags: withoutIds };
  }

  const wantTags = trigger.withTags.map((t) => t.toLowerCase());
  const minVisits = trigger.minVisits ?? 0;
  const inactiveMs = trigger.inactiveDays ? trigger.inactiveDays * DAY_MS : null;
  const maxInactiveMs = trigger.maxInactiveDays ? trigger.maxInactiveDays * DAY_MS : null;

  return {
    filter: Object.keys(filter).length > 1 ? filter : undefined,
    impossible: missingWith.length > 0 ? `missing tag: ${missingWith.join(', ')}` : undefined,
    pastWindow(member) {
      if (maxInactiveMs === null) return false;
      const lastSeen = Date.parse(member.lastSeen);
      return Number.isFinite(lastSeen) && Date.now() - lastSeen > maxInactiveMs;
    },
    matches(member) {
      // The visits filter may count bookings; require actual check-ins.
      if (member.visits.totalVisits < minVisits) return false;
      if (inactiveMs !== null || maxInactiveMs !== null) {
        const lastSeen = Date.parse(member.lastSeen);
        if (!Number.isFinite(lastSeen)) return false;
        const away = Date.now() - lastSeen;
        if (inactiveMs !== null && away < inactiveMs) return false;
        if (maxInactiveMs !== null && away > maxInactiveMs) return false;
      }
      const names = new Set(member.customerTags.map((t) => t.name.toLowerCase()));
      return wantTags.every((t) => names.has(t));
    },
  };
}

// Members are read in this order everywhere, which is what lets a scan stop
// as soon as it passes an audience's "seen within N days" edge.
const SWEEP_SORT = { sortBy: 'lastSeenAt', sortOrder: 'DESC' } as const;

const PREVIEW_MAX_PAGES = 30;
/** Enroll conditions can cost a Momence call each; check a sample and extrapolate. */
const PREVIEW_CONDITION_SAMPLE = 60;
const PREVIEW_CONDITION_CONCURRENCY = 10;

export interface AudiencePreview {
  /** Members read from Momence. */
  scanned: number;
  /** Members Momence's own filter returned in total. */
  totalCandidates: number;
  /** Matched the audience (days away, visits, tags). */
  inAudience: number;
  /** Of those, how many had the enroll conditions checked, and how many passed. */
  checked: number;
  passed: number;
  /** Estimated enrollments right now (exact when every match was checked). */
  estimated: number;
  sample: string[];
  /** The scan stopped at its page limit before reaching the end. */
  partial: boolean;
}

/**
 * Who an audience journey would enroll right now. Reads the member list the
 * way the sweep does (newest visit first, stopping once past the audience's
 * window), then checks the enroll conditions on a sample of the matches.
 * Doesn't look at who is already enrolled.
 */
export async function previewAudience(journey: JourneyRecord): Promise<AudiencePreview> {
  const empty: AudiencePreview = {
    scanned: 0,
    totalCandidates: 0,
    inAudience: 0,
    checked: 0,
    passed: 0,
    estimated: 0,
    sample: [],
    partial: false,
  };
  const trigger = journey.definition.trigger;
  if (trigger.type !== 'sweep') return empty;
  const audience = await sweepAudience(trigger);
  if (audience.impossible) return empty;

  let scanned = 0;
  let totalCandidates = 0;
  let partial = true;
  const matches: HostMember[] = [];
  for (let page = 0; page < PREVIEW_MAX_PAGES; page += 1) {
    const { members, totalCount } = await fetchMembersFiltered({
      page,
      pageSize: SWEEP_PAGE_SIZE,
      filter: audience.filter,
      ...SWEEP_SORT,
    });
    totalCandidates = totalCount;
    scanned += members.length;
    let done = members.length < SWEEP_PAGE_SIZE;
    for (const member of members) {
      if (audience.pastWindow(member)) {
        done = true;
        break;
      }
      if (audience.matches(member)) matches.push(member);
    }
    if (done) {
      partial = false;
      break;
    }
  }

  const toCheck = matches.slice(0, PREVIEW_CONDITION_SAMPLE);
  const passedMembers: HostMember[] = [];
  if (journey.definition.enrollIf.length === 0) {
    passedMembers.push(...toCheck);
  } else {
    for (let i = 0; i < toCheck.length; i += PREVIEW_CONDITION_CONCURRENCY) {
      const batch = toCheck.slice(i, i + PREVIEW_CONDITION_CONCURRENCY);
      const results = await Promise.all(
        batch.map((member) =>
          allMatch(
            buildContext(memberIdentity(member), { member }),
            journey.definition.enrollIf
          ).catch(() => false)
        )
      );
      batch.forEach((member, j) => {
        if (results[j]) passedMembers.push(member);
      });
    }
  }

  const checked = toCheck.length;
  const passed = passedMembers.length;
  return {
    scanned,
    totalCandidates,
    inAudience: matches.length,
    checked,
    passed,
    estimated: checked === 0 ? 0 : Math.round((passed / checked) * matches.length),
    sample: passedMembers.slice(0, 10).map((m) => m.email),
    partial,
  };
}

function memberIdentity(member: HostMember): MemberIdentity {
  return {
    memberId: member.id,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
  };
}

export async function runEnrollmentSweeps(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const journeys = (await loadJourneys()).filter((j) => j.definition.trigger.type === 'sweep');
  const gate = await getEmailGate();
  const summary: Record<string, unknown> = {};

  for (const journey of journeys) {
    const trigger = journey.definition.trigger as Extract<Trigger, { type: 'sweep' }>;
    if (!journey.enabled) {
      // Leave the Redis cursor alone — the sweep resumes mid-audience when the
      // journey comes back on.
      summary[journey.id] = { skipped: 'disabled' };
      continue;
    }
    if (ctx.timeRemainingMs() < SWEEP_MIN_REMAINING_MS) {
      summary[journey.id] = { skipped: 'out-of-time' };
      continue;
    }

    const audience = await sweepAudience(trigger);
    if (audience.impossible) {
      log.warn(`Sweep ${journey.id} can't match anyone (${audience.impossible})`);
      summary[journey.id] = { skipped: audience.impossible };
      continue;
    }

    const cursorKey = `${SWEEP_CURSOR_PREFIX}${journey.id}:cursor`;
    let page = 0;
    if (redis) {
      const cursor = await redis.get<number>(cursorKey);
      if (typeof cursor === 'number') page = cursor;
    }

    let scanned = 0;
    let enrolled = 0;
    let wrapped = false;

    while (ctx.timeRemainingMs() >= SWEEP_MIN_REMAINING_MS) {
      const { members } = await fetchMembersFiltered({
        page,
        pageSize: SWEEP_PAGE_SIZE,
        filter: audience.filter,
        ...SWEEP_SORT,
      });
      scanned += members.length;

      let passedWindow = false;
      for (const member of members) {
        if (audience.pastWindow(member)) {
          passedWindow = true;
          break;
        }
        try {
          if (!audience.matches(member)) continue;
          if (journey.testMode && !gate.isAllowed(member.email)) continue;
          const identity = memberIdentity(member);
          const memberCtx = buildContext(identity, { member });
          if (!(await allMatch(memberCtx, journey.definition.enrollIf))) continue;
          const outcome = await enrollMember(journey, identity, {
            dryRun: ctx.dryRun,
            ctx: memberCtx,
            gate,
          });
          if (outcome === 'enrolled') enrolled += 1;
        } catch (error) {
          log.warn(`Sweep check/enroll failed for ${journey.id} member ${member.id}`, error);
        }
      }

      if (members.length < SWEEP_PAGE_SIZE || passedWindow) {
        // End of the audience (or past its "seen within" edge — everyone
        // further down was seen even longer ago) — next tick starts over
        // (enrollment is idempotent, so rescanning is cheap and catches new
        // matches).
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
/** A step whose anchor moved later (intro extended, timing edited) waits again. */
const EARLY_TOLERANCE_MS = 5 * 60_000;

async function recentMarketingSends(email: string, now: number): Promise<number[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from('email_sends')
    .select('sent_at')
    .eq('email', email)
    .eq('kind', 'marketing')
    .eq('status', 'sent')
    .gte('sent_at', new Date(now - 7 * DAY_MS).toISOString());
  if (error) {
    log.warn(`Frequency-cap lookup failed for ${email}: ${error.message}`);
    return [];
  }
  return (data as { sent_at: string }[]).map((r) => Date.parse(r.sent_at));
}

function templateProps(key: string, firstName: string): Record<string, unknown> {
  if (key === 'review-request') {
    // Source: apps/social/posts/google-review-card (the QR postcard). No utm
    // params: it's a Google deep link we don't control.
    return {
      firstName,
      reviewUrl: import.meta.env.GOOGLE_REVIEW_URL ?? 'https://g.page/r/CbPLgfm6vte6EAI/review',
    };
  }
  return { firstName };
}

type StepOutcome =
  | { kind: 'sent' }
  | { kind: 'advanced'; reason: string }
  | { kind: 'exited'; reason: string }
  | { kind: 'deferred'; until: number; reason: string }
  | { kind: 'would-send'; label: string };

export async function advanceDueJourneys(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const db = getDb();
  if (!db) return { skipped: 'supabase-not-configured' };

  // Only switched-on journeys' rows are loaded: a paused journey's backlog
  // stays due and sorts oldest-first, so skipping it in the loop would let it
  // eat the whole batch and stall every other journey.
  const journeys = new Map((await loadJourneys()).filter((j) => j.enabled).map((j) => [j.id, j]));
  if (journeys.size === 0) return { due: 0, enabledJourneys: 0 };

  const { data: due, error } = await db
    .from('journey_enrollments')
    .select('*')
    .eq('status', 'active')
    .lte('next_at', new Date().toISOString())
    .in('journey_id', [...journeys.keys()])
    .order('next_at', { ascending: true })
    .limit(ADVANCE_BATCH_SIZE);

  if (error) {
    log.error(`Could not load due enrollments: ${error.message}`);
    return { error: error.message };
  }

  const gate = await getEmailGate();
  const counts = { sent: 0, skippedSteps: 0, exited: 0, completed: 0, deferred: 0 };
  const wouldSend: string[] = [];

  for (const row of (due ?? []) as JourneyEnrollmentRow[]) {
    if (ctx.timeRemainingMs() < ADVANCE_MIN_REMAINING_MS) break;
    const journey = journeys.get(row.journey_id);
    if (!journey) continue;

    try {
      const outcome = await runDueStep(journey, row, { dryRun: ctx.dryRun, gate });
      switch (outcome.kind) {
        case 'sent':
          counts.sent += 1;
          break;
        case 'advanced':
          counts.skippedSteps += outcome.reason === 'completed' ? 0 : 1;
          if (outcome.reason === 'completed') counts.completed += 1;
          break;
        case 'exited':
          counts.exited += 1;
          break;
        case 'deferred':
          counts.deferred += 1;
          break;
        case 'would-send':
          wouldSend.push(outcome.label);
          break;
      }
    } catch (error) {
      // Leave the row as-is; next tick retries (send dedupe makes that safe).
      log.warn(`Advance failed for ${row.journey_id} member ${row.member_id}`, error);
    }
  }

  return {
    due: due?.length ?? 0,
    ...counts,
    ...(ctx.dryRun && { wouldSend }),
  };
}

async function runDueStep(
  journey: JourneyRecord,
  row: JourneyEnrollmentRow,
  { dryRun, gate }: { dryRun: boolean; gate: EmailGate }
): Promise<StepOutcome> {
  const steps = journey.definition.steps;
  const index = row.current_step_key ? currentStepIndex(steps, row.current_step_key) : null;
  if (index === null) {
    if (!dryRun) await completeJourney(journey, row);
    return { kind: 'advanced', reason: 'completed' };
  }
  const step = steps[index];

  if (journey.testMode && !gate.isAllowed(row.email)) {
    if (!dryRun) await exitJourney(journey, row, 'not-whitelisted', step.key);
    return { kind: 'exited', reason: 'not-whitelisted' };
  }

  // The row only stores id + email; pull the live member once per row so exit
  // checks, skip checks and merge fields all share it. Packs fresh: this is
  // the last look before a send.
  const member = await fetchHostMember(row.member_id);
  const memberCtx = buildContext(
    {
      memberId: row.member_id,
      email: row.email,
      firstName: member.firstName,
      lastName: member.lastName,
    },
    {
      member,
      enrolledAt: Date.parse(row.enrolled_at),
      enrollment: row.context as EnrollmentContext,
      freshPacks: true,
    }
  );

  const exit = await firstMatch(memberCtx, journey.definition.exitIf);
  if (exit) {
    const reason = `exit:${exit.negate ? 'not-' : ''}${exit.type}`;
    if (!dryRun) await exitJourney(journey, row, reason, step.key);
    return { kind: 'exited', reason };
  }

  const now = Date.now();
  const introExpiresAt =
    step.timing.anchor === 'intro-expiry' ? await resolveIntroExpiry(memberCtx) : null;
  const anchors = anchorsFor(row, introExpiresAt);

  if (step.timing.anchor !== 'previous') {
    const dueAt = stepDueAt(step.timing, anchors, { fastMode: isFastMode() });
    if (dueAt === null) {
      if (!dryRun) await advance(journey, row, step, memberCtx, 'no-intro-offer');
      return { kind: 'advanced', reason: 'no-intro-offer' };
    }
    if (dueAt > now + EARLY_TOLERANCE_MS) {
      if (!dryRun) await reschedule(row, scheduleAt(step, anchors, now));
      return { kind: 'deferred', until: dueAt, reason: 'not-yet-due' };
    }
    if (isStale(step.timing, dueAt, anchors, now)) {
      if (!dryRun) await advance(journey, row, step, memberCtx, 'stale');
      return { kind: 'advanced', reason: 'stale' };
    }
  }

  const skip = await firstMatch(memberCtx, step.skipIf);
  if (skip) {
    const reason = `skip:${skip.negate ? 'not-' : ''}${skip.type}`;
    if (!dryRun) await advance(journey, row, step, memberCtx, reason);
    return { kind: 'advanced', reason };
  }

  if (step.content.type === 'none') {
    if (dryRun)
      return {
        kind: 'would-send',
        label: `${journey.id}/${step.key} (actions only) -> ${row.email}`,
      };
    await runActions(step.actions, row.member_id);
    await advance(journey, row, step, memberCtx, 'actions-only');
    return { kind: 'advanced', reason: 'actions-only' };
  }

  // Frequency cap across every journey — nobody gets a pile of marketing at once.
  const capUntil = frequencyCapUntil(await recentMarketingSends(row.email, now), now);
  if (capUntil !== null) {
    if (!dryRun)
      await reschedule(
        row,
        new Date(isFastMode() ? capUntil : clampToSendWindow(capUntil)).toISOString()
      );
    return { kind: 'deferred', until: capUntil, reason: 'frequency-cap' };
  }

  let send: Parameters<typeof sendTemplate>[0];
  const common = {
    to: row.email,
    kind: 'marketing' as const,
    sendKey: sendKeyFor(journey.id, row.member_id, step.key, row.cycle),
    memberId: row.member_id,
    journeyId: journey.id,
    stepId: step.key,
    journeyRevision: journey.revision,
    whitelistOnly: journey.testMode,
  };

  if (step.content.type === 'blocks') {
    const values = await mergeValues(memberCtx, usedFields(step.content));
    const { content, missing } = fillContent(step.content, values);
    if (missing.length > 0) {
      const reason = `missing-merge-field:${missing.join(',')}`;
      if (!dryRun) await advance(journey, row, step, memberCtx, reason);
      return { kind: 'advanced', reason };
    }
    send = {
      ...common,
      template: 'journey',
      props: {
        firstName: memberCtx.firstName,
        subject: content.subject,
        preview: content.preview,
        background: content.background,
        blocks: content.blocks,
        campaign: journeyCampaign(journey.id, journey.definition),
        stepKey: step.key,
      },
    };
  } else {
    if (!isTemplateStepKey(step.content.key)) {
      if (!dryRun) await advance(journey, row, step, memberCtx, 'unknown-template');
      return { kind: 'advanced', reason: 'unknown-template' };
    }
    send = {
      ...common,
      template: step.content.key,
      props: templateProps(step.content.key, memberCtx.firstName) as never,
    };
  }

  if (dryRun) return { kind: 'would-send', label: `${journey.id}/${step.key} -> ${row.email}` };

  await runActions(step.actions, row.member_id);
  const result = await sendTemplate(send);

  if (result.status === 'suppressed' && result.reason === 'unsubscribed') {
    await exitJourney(journey, row, 'unsubscribed', step.key);
    return { kind: 'exited', reason: 'unsubscribed' };
  }

  if (result.status === 'sent') {
    await captureEvent({
      distinctId: row.email,
      event: 'journey_email_sent',
      properties: {
        journey: journey.id,
        step: step.key,
        template: send.template,
        cycle: row.cycle,
      },
    });
  }

  // 'sent', 'already-sent', and dev-gate suppression all advance — the step
  // is done either way.
  await advance(journey, row, step, memberCtx, result.status);
  return result.status === 'sent' ? { kind: 'sent' } : { kind: 'advanced', reason: result.status };
}

async function advance(
  journey: JourneyRecord,
  row: JourneyEnrollmentRow,
  step: JourneyStep,
  memberCtx: JourneyContext,
  reason: string
): Promise<void> {
  const steps = journey.definition.steps;
  const nextIndex = nextStepIndex(steps, step.key);
  if (reason !== 'sent') log.info(`${journey.id}/${step.key} member ${row.member_id}: ${reason}`);
  if (nextIndex === null) {
    await completeJourney(journey, row);
    return;
  }

  const next = steps[nextIndex];
  const now = Date.now();
  let context = row.context as EnrollmentContext;
  let introExpiresAt: number | null = null;
  if (next.timing.anchor === 'intro-expiry') {
    introExpiresAt = await resolveIntroExpiry(memberCtx).catch(() => null);
    if (introExpiresAt !== null) {
      context = { ...context, introExpiresAt: new Date(introExpiresAt).toISOString() };
    }
  }
  const lastStepAt = new Date(now).toISOString();
  await transition(row, {
    current_step_key: next.key,
    last_step_at: lastStepAt,
    context: context as Record<string, unknown>,
    next_at: scheduleAt(
      next,
      anchorsFor({ ...row, last_step_at: lastStepAt }, introExpiresAt),
      now
    ),
  });
}

async function completeJourney(journey: JourneyRecord, row: JourneyEnrollmentRow): Promise<void> {
  await transition(row, {
    status: 'completed',
    next_at: null,
    current_step_key: null,
    ended_at: new Date().toISOString(),
  });
  await captureEvent({
    distinctId: row.email,
    event: 'journey_completed',
    properties: { journey: journey.id },
  });

  const { completionTag, onEnd } = journey.definition;
  if (completionTag) await runActions([{ type: 'add-tag', tag: completionTag }], row.member_id);
  await runActions(onEnd, row.member_id);
}

export async function exitJourney(
  journey: JourneyRecord,
  row: Pick<JourneyEnrollmentRow, 'id' | 'email' | 'member_id'>,
  reason: string,
  stepKey?: string
): Promise<void> {
  await transition(row, {
    status: 'exited',
    exit_reason: reason,
    next_at: null,
    ended_at: new Date().toISOString(),
  });
  await captureEvent({
    distinctId: row.email,
    event: 'journey_exited',
    properties: { journey: journey.id, step: stepKey, reason },
  });
  await runActions(journey.definition.onEnd, row.member_id);
}

async function reschedule(row: JourneyEnrollmentRow, nextAt: string): Promise<void> {
  await transition(row, { next_at: nextAt });
}

async function transition(
  row: Pick<JourneyEnrollmentRow, 'id'>,
  patch: Partial<
    Pick<
      JourneyEnrollmentRow,
      | 'current_step_key'
      | 'next_at'
      | 'status'
      | 'exit_reason'
      | 'last_step_at'
      | 'context'
      | 'ended_at'
    >
  >
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db.from('journey_enrollments').update(patch).eq('id', row.id);
  if (error) {
    log.error(`Enrollment update failed for ${row.id}: ${error.message}`);
  }
}

// --- Admin-triggered maintenance ---

/**
 * Pull every step that came due while a journey was paused forward to now.
 * Without this, a journey paused for a month leaves rows sorted a month deep
 * at the head of the `order by next_at` queue, crowding out every other
 * journey's genuinely-due sends batch after batch. (Anchored steps that went
 * stale meanwhile are skipped at run time, not sent late.)
 */
export async function resumeHeldEnrollments(journeyId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('journey_enrollments')
    .update({ next_at: now })
    .eq('journey_id', journeyId)
    .eq('status', 'active')
    .lt('next_at', now)
    .select('id');
  if (error) {
    log.error(`Resume reschedule failed for ${journeyId}: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Re-time people waiting on steps whose timing just changed. Uses what the
 * row remembers (anchor, previous step, last known intro expiry) — the
 * due-time check re-reads Momence anyway.
 */
export async function rescheduleWaiting(
  journey: JourneyRecord,
  stepKeys: string[]
): Promise<number> {
  const db = getDb();
  if (!db || stepKeys.length === 0) return 0;
  const { data, error } = await db
    .from('journey_enrollments')
    .select('*')
    .eq('journey_id', journey.id)
    .eq('status', 'active')
    .in('current_step_key', stepKeys);
  if (error) {
    log.error(`Reschedule lookup failed for ${journey.id}: ${error.message}`);
    return 0;
  }
  const now = Date.now();
  let updated = 0;
  for (const row of data as JourneyEnrollmentRow[]) {
    const step = journey.definition.steps.find((s) => s.key === row.current_step_key);
    if (!step) continue;
    const remembered = (row.context as EnrollmentContext).introExpiresAt;
    const anchors = anchorsFor(row, remembered ? Date.parse(remembered) : null);
    await transition(row, { next_at: scheduleAt(step, anchors, now) });
    updated += 1;
  }
  return updated;
}
