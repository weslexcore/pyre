import type { EmailPropsByTemplate, EmailTemplateKey } from '@/emails/types';
import type { BoughtMembership, HostMember, MemberListFilter } from '@/lib/momence/host-api';
import type { TriggerEvent, TriggerEventType } from '@/lib/triggers/dispatch';

// Journey model. Momence is the source of truth: enrollment rows in Supabase
// remember WHERE someone is (journey, step, next due time) — never WHY. Exit
// conditions and per-step skip checks re-read live Momence data immediately
// before every send, so stale state can't cause a wrong email.

export interface JourneyContext {
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
  /** Full member row (visits, tags, lastSeen) — lazy, cached for this run. */
  member(): Promise<HostMember>;
  /** Active subscriptions + credit packs — lazy, cached for this run. */
  activePacks(): Promise<BoughtMembership[]>;
}

export interface JourneyStep<K extends EmailTemplateKey = EmailTemplateKey> {
  /** Stable id — part of the send dedupe key; never rename after launch. */
  id: string;
  /** Hours after the previous step (or enrollment). JOURNEY_FAST_MODE=true turns hours into minutes for whitelist testing. */
  delayHours: number;
  template: K;
  props(ctx: JourneyContext): Promise<EmailPropsByTemplate[K]>;
  /** Skip this step (advance without sending) when true — e.g. step is moot now. */
  skipIf?(ctx: JourneyContext): Promise<boolean>;
}

/** Preserves the template->props pairing per step while the journey holds a heterogeneous list. */
export function defineStep<K extends EmailTemplateKey>(step: JourneyStep<K>): JourneyStep {
  return step as unknown as JourneyStep;
}

export interface SweepAudience {
  /** Momence server-side include/exclude filter (tags not-have, visit counts, membership state...). */
  filter?: MemberListFilter;
  filterPreset?: 'with-active-membership';
  /** Code-level refinement for what the filter can't express. Runs per candidate. */
  predicate?(member: HostMember, ctx: JourneyContext): Promise<boolean>;
}

export type JourneyEnrollment =
  /** Discovered by the hourly sweep paging POST /host/members/list. */
  | { source: 'sweep'; audience(): Promise<SweepAudience> }
  /** Enrolled the moment an internal trigger event fires (webhook or sales poller). */
  | {
      source: 'event';
      events: TriggerEventType[];
      when(event: TriggerEvent, ctx: JourneyContext): Promise<boolean>;
    };

export interface Journey {
  /** Stable id — keys enrollment rows and dedupe keys; never rename after launch. */
  id: string;
  /** marketing = suppression-checked + unsubscribe link. Almost always 'marketing'. */
  kind: 'marketing' | 'transactional';
  enroll: JourneyEnrollment;
  /**
   * Re-checked against live Momence data before EVERY step send. Return an
   * exit reason string to leave the journey (recorded on the enrollment row),
   * or null to continue.
   */
  exitWhen?(ctx: JourneyContext): Promise<string | null>;
  steps: JourneyStep[];
  /** Momence tag written back after the journey's final step (visible to staff). */
  completionTag?: string;
}
