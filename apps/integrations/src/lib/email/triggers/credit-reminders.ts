import { createWebhookLogger, getRedis } from '@pyre/webhook-core';
import type { CronJobContext } from '@/lib/cron/jobs';
import {
  type BoughtMembership,
  fetchMemberActivePacks,
  fetchMembersFiltered,
  type HostMember,
} from '@/lib/momence/host-api';
import { sendTemplate } from '../send';

const log = createWebhookLogger('Credit Reminders');

// Per-pack reminder sweeps (NOT journeys — a member can buy packs repeatedly,
// so these dedupe per bought-membership via email_sends.send_key, not via
// enrollment rows):
//   credit expiry  — pack has credits left and an endDate within 14d / 3d
//   unused credits — pack has credits left, no imminent expiry, and the
//                    member hasn't been seen in 45+ days (re-fires at most
//                    once a quarter per pack via a quarter-bucketed key)
// Everything is read live from Momence; the only state is the send log and a
// resumable page cursor.

const CURSOR_KEY = 'sweep:credit-reminders:cursor';
const PAGE_SIZE = 50;
const MIN_REMAINING_MS = 10_000;

const EXPIRY_WINDOWS = [
  { days: 3, keySuffix: '3' },
  { days: 14, keySuffix: '14' },
] as const;

const UNUSED_AFTER_DAYS = 45;
const UNUSED_MIN_EXPIRY_BUFFER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function creditsLabelFor(pack: BoughtMembership): string | null {
  if (pack.type === 'package-events' && pack.eventCreditsLeft) {
    const n = pack.eventCreditsLeft;
    return `${n} credit${n === 1 ? '' : 's'}`;
  }
  if (pack.type === 'package-money' && pack.moneyCreditsLeft) {
    return `$${pack.moneyCreditsLeft} in credit`;
  }
  return null;
}

function quarterBucket(now: Date): string {
  return `${now.getUTCFullYear()}-q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

interface SweepCounters {
  scanned: number;
  expirySent: number;
  unusedSent: number;
  wouldSend: string[];
}

async function processMember(
  member: HostMember,
  ctx: CronJobContext,
  counters: SweepCounters
): Promise<void> {
  const packs = await fetchMemberActivePacks(member.id);
  const now = Date.now();
  const lastSeenMs = Date.parse(member.lastSeen);
  const dormant = Number.isFinite(lastSeenMs) && now - lastSeenMs > UNUSED_AFTER_DAYS * DAY_MS;

  for (const pack of packs) {
    if (pack.isFrozen) continue;
    const creditsLabel = creditsLabelFor(pack);
    if (!creditsLabel) continue;

    const endMs = pack.endDate ? Date.parse(pack.endDate) : null;
    const daysLeft = endMs ? Math.ceil((endMs - now) / DAY_MS) : null;

    if (daysLeft !== null && daysLeft <= 0) continue; // already expired

    // Expiry reminders: tightest matching window wins; each window sends once
    // per pack (send_key dedupe handles retries and re-scans).
    if (daysLeft !== null && daysLeft <= 14) {
      const window = EXPIRY_WINDOWS.find((w) => daysLeft <= w.days) ?? EXPIRY_WINDOWS[1];
      const sendKey = `credit-expiry:${pack.id}:${window.keySuffix}`;

      if (ctx.dryRun) {
        counters.wouldSend.push(`${sendKey} -> ${member.email}`);
      } else {
        const result = await sendTemplate({
          to: member.email,
          template: 'credit-expiry-reminder',
          props: {
            firstName: member.firstName,
            creditsLabel,
            expiresOn: new Date(endMs as number).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              timeZone: 'America/New_York',
            }),
            daysLeft,
          },
          kind: 'marketing',
          sendKey,
          memberId: member.id,
          campaign: 'credit-expiry',
        });
        if (result.status === 'sent') counters.expirySent += 1;
      }
      continue; // an expiring pack never also gets the "unused" nudge
    }

    // Unused-credit nudge: dormant member, no expiry pressure.
    const noImminentExpiry = daysLeft === null || daysLeft > UNUSED_MIN_EXPIRY_BUFFER_DAYS;
    if (dormant && noImminentExpiry) {
      const sendKey = `unused-credit:${pack.id}:${quarterBucket(new Date(now))}`;

      if (ctx.dryRun) {
        counters.wouldSend.push(`${sendKey} -> ${member.email}`);
      } else {
        const result = await sendTemplate({
          to: member.email,
          template: 'unused-credit-reminder',
          props: { firstName: member.firstName, creditsLabel },
          kind: 'marketing',
          sendKey,
          memberId: member.id,
          campaign: 'unused-credit',
        });
        if (result.status === 'sent') counters.unusedSent += 1;
      }
    }
  }
}

export async function runCreditReminders(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const redis = getRedis();

  let page = 0;
  if (redis) {
    const cursor = await redis.get<number>(CURSOR_KEY);
    if (typeof cursor === 'number') page = cursor;
  }

  const counters: SweepCounters = { scanned: 0, expirySent: 0, unusedSent: 0, wouldSend: [] };
  let wrapped = false;

  while (ctx.timeRemainingMs() >= MIN_REMAINING_MS) {
    // Everyone holding an active membership/pack; the per-member pack fetch is
    // cached 20h so the hourly re-scan stays cheap.
    const { members } = await fetchMembersFiltered({
      page,
      pageSize: PAGE_SIZE,
      filterPreset: 'with-active-membership',
    });
    counters.scanned += members.length;

    for (const member of members) {
      if (ctx.timeRemainingMs() < MIN_REMAINING_MS) break;
      try {
        await processMember(member, ctx, counters);
      } catch (error) {
        log.warn(`Credit sweep failed for member ${member.id}`, error);
      }
    }

    if (members.length < PAGE_SIZE) {
      page = 0;
      wrapped = true;
      break;
    }
    page += 1;
  }

  if (redis && !ctx.dryRun) {
    await redis.set(CURSOR_KEY, page);
  }

  return {
    scanned: counters.scanned,
    expirySent: counters.expirySent,
    unusedSent: counters.unusedSent,
    resumePage: wrapped ? 0 : page,
    ...(ctx.dryRun && { wouldSend: counters.wouldSend }),
  };
}
