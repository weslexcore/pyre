import { z } from 'zod';

// The journey definition: everything about a journey an admin can change from
// /admin/journeys, stored as one jsonb document on the journeys row and
// snapshotted into journey_revisions on every save. Plain zod and constants
// only, so the admin island and the server validate against the same schema.
//
// What a journey can DO is fixed by the catalogs below (conditions, triggers,
// actions, merge fields); what a journey IS — which of those it uses, when,
// and what the email says — is data. A journey that needs a new kind of
// condition is a code change here plus its implementation in ./catalog.

// --- Conditions ---

export const CONDITION_TYPES = [
  'has-active-membership',
  'has-active-intro',
  'ever-bought-intro',
  'has-non-intro-purchase',
  'has-credits',
  'intro-expired',
  'attended-trigger-session',
  'visited-since-enrollment',
  'has-tag',
  'total-visits-at-least',
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];

export const conditionSchema = z.object({
  type: z.enum(CONDITION_TYPES),
  /** true flips the check: "has-credits" + negate = "has no credits". */
  negate: z.boolean().default(false),
  /** Only has-tag reads this. */
  tag: z.string().trim().max(80).optional(),
  /** Only total-visits-at-least reads this. */
  count: z.number().int().min(0).max(1000).optional(),
});

export type Condition = z.infer<typeof conditionSchema>;

export interface ConditionMeta {
  label: string;
  /** How the negated form reads, e.g. "Has no credits". */
  negatedLabel: string;
  description: string;
  param?: 'tag' | 'count';
  /** Needs the session that triggered enrollment (session-booked journeys). */
  needsSession?: boolean;
}

export const CONDITIONS: Record<ConditionType, ConditionMeta> = {
  'has-active-membership': {
    label: 'Has an active membership',
    negatedLabel: 'Has no active membership',
    description: 'A recurring subscription that is not the intro offer.',
  },
  'has-active-intro': {
    label: 'Has an active intro offer',
    negatedLabel: 'Has no active intro offer',
    description: 'The intro offer pack is on their account and not expired.',
  },
  'ever-bought-intro': {
    label: 'Has ever bought the intro offer',
    negatedLabel: 'Has never bought the intro offer',
    description: 'Any intro offer purchase on record, expired or not.',
  },
  'has-non-intro-purchase': {
    label: 'Owns something beyond the intro',
    negatedLabel: 'Owns nothing beyond the intro',
    description: 'Any active membership or credit pack other than the intro offer.',
  },
  'has-credits': {
    label: 'Has credits left',
    negatedLabel: 'Has no credits left',
    description: 'Unused credits on any active pack (intro included).',
  },
  'intro-expired': {
    label: 'Intro offer has expired',
    negatedLabel: 'Intro offer has not expired',
    description: 'They bought the intro offer and it is no longer active.',
  },
  'attended-trigger-session': {
    label: 'Checked in to the session',
    negatedLabel: 'Did not check in to the session',
    description: 'They were checked in to the session that enrolled them.',
    needsSession: true,
  },
  'visited-since-enrollment': {
    label: 'Visited since enrolling',
    negatedLabel: 'Has not visited since enrolling',
    description: 'Momence shows them in the studio after they entered this journey.',
  },
  'has-tag': {
    label: 'Has Momence tag',
    negatedLabel: 'Does not have Momence tag',
    description: 'A customer tag in Momence (exact name).',
    param: 'tag',
  },
  'total-visits-at-least': {
    label: 'Checked-in visits at least',
    negatedLabel: 'Checked-in visits fewer than',
    description: 'Lifetime checked-in visits.',
    param: 'count',
  },
};

// --- Triggers ---

export const TRIGGER_TYPES = ['session-booked', 'sweep', 'manual'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session-booked'),
    /** Only a member's first-ever booking enrolls. */
    firstBookingOnly: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('sweep'),
    /** Last seen in the studio at least this many days ago. */
    inactiveDays: z.number().int().min(1).max(3650).optional(),
    /** ...but no more than this many days ago (keeps long-lapsed customers out). */
    maxInactiveDays: z.number().int().min(1).max(3650).optional(),
    /** Lifetime checked-in visits at least this many. */
    minVisits: z.number().int().min(0).max(1000).optional(),
    /** Members carrying ALL of these tags. */
    withTags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    /** Members carrying NONE of these tags. */
    withoutTags: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  }),
  z.object({ type: z.literal('manual') }),
]);

export type Trigger = z.infer<typeof triggerSchema>;

export const TRIGGERS: Record<TriggerType, { label: string; description: string }> = {
  'session-booked': {
    label: 'Books a session',
    description:
      'Enrolls the moment Momence reports a booking. Steps can be timed from when the session ends.',
  },
  sweep: {
    label: 'Matches an audience',
    description:
      'An hourly sweep of Momence members finds everyone who matches, e.g. not seen for 30 days.',
  },
  manual: {
    label: 'Added by hand',
    description: 'Only people you add from the People tab.',
  },
};

// --- Timing ---

export const TIMING_ANCHORS = ['trigger', 'previous', 'intro-expiry'] as const;
export type TimingAnchor = (typeof TIMING_ANCHORS)[number];

export const timingSchema = z.object({
  anchor: z.enum(TIMING_ANCHORS),
  /** Hours from the anchor; negative = before it (only meaningful for intro-expiry). */
  offsetHours: z
    .number()
    .min(-24 * 365)
    .max(24 * 365),
});

export type StepTiming = z.infer<typeof timingSchema>;

export const ANCHORS: Record<TimingAnchor, { label: string; description: string }> = {
  trigger: {
    label: 'Enrollment',
    description:
      'When they entered the journey. For session bookings, when the booked session ends.',
  },
  previous: {
    label: 'Previous email',
    description: 'When the previous step ran (or enrollment, for the first step).',
  },
  'intro-expiry': {
    label: 'Intro offer expiry',
    description:
      'When their intro offer pack expires. The step is skipped if they have no intro offer.',
  },
};

// --- Actions ---

export const actionSchema = z.object({
  type: z.enum(['add-tag', 'remove-tag']),
  tag: z.string().trim().min(1).max(80),
});

export type JourneyAction = z.infer<typeof actionSchema>;

// --- Email content ---

export const EMAIL_BACKGROUNDS = ['trees', 'clouds', 'lamps'] as const;

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().max(200) }),
  /** Markdown subset: **bold**, *italic*, [label](url). Blank lines split paragraphs. */
  z.object({ type: z.literal('paragraph'), text: z.string().max(5000) }),
  z.object({ type: z.literal('list'), items: z.array(z.string().max(500)).max(20) }),
  z.object({
    type: z.literal('button'),
    label: z.string().max(80),
    url: z.string().max(1000),
  }),
  z.object({ type: z.literal('divider') }),
  z.object({
    type: z.literal('image'),
    src: z.string().max(1000),
    alt: z.string().max(200),
    href: z.string().max(1000).optional(),
  }),
  z.object({ type: z.literal('signoff'), text: z.string().max(200) }),
]);

export type EmailBlock = z.infer<typeof blockSchema>;
export type EmailBlockType = EmailBlock['type'];

export const blockContentSchema = z.object({
  type: z.literal('blocks'),
  subject: z.string().trim().min(1).max(200),
  /** Inbox preview line. */
  preview: z.string().max(200).default(''),
  background: z.enum(EMAIL_BACKGROUNDS).default('trees'),
  blocks: z.array(blockSchema).max(60),
});

export type BlockContent = z.infer<typeof blockContentSchema>;

/** Coded templates a step may send instead of blocks (the converted journeys). */
export const TEMPLATE_STEP_KEYS = [
  'intro-follow-up',
  'credit-pack-pitch',
  'membership-pitch',
  'review-request',
] as const;

export type TemplateStepKey = (typeof TEMPLATE_STEP_KEYS)[number];

export function isTemplateStepKey(key: string): key is TemplateStepKey {
  return (TEMPLATE_STEP_KEYS as readonly string[]).includes(key);
}

/** A coded React Email template from src/emails/registry.ts (converted journeys). */
export const templateContentSchema = z.object({
  type: z.literal('template'),
  key: z.string().min(1),
});

/** No email: the step only waits and runs its actions (e.g. a discount window closing). */
export const noContentSchema = z.object({ type: z.literal('none') });

export const contentSchema = z.discriminatedUnion('type', [
  blockContentSchema,
  templateContentSchema,
  noContentSchema,
]);

export type StepContent = z.infer<typeof contentSchema>;

// --- Steps + journey ---

export const STEP_KEY_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const stepSchema = z.object({
  /** Stable id — part of the send dedupe key; never changes once the step exists. */
  key: z.string().regex(STEP_KEY_RE, 'lowercase letters, numbers and dashes'),
  /** Admin-facing label, e.g. "Prorate offer". */
  name: z.string().trim().max(80).default(''),
  /** Archived steps are skipped but kept so send history keeps its meaning. */
  archived: z.boolean().default(false),
  timing: timingSchema,
  /** Skip this step (move on without sending) when ANY of these match. */
  skipIf: z.array(conditionSchema).max(10).default([]),
  /** Run just before the email is sent (e.g. tag them for a discount Price Rule). */
  actions: z.array(actionSchema).max(5).default([]),
  content: contentSchema,
});

export type JourneyStep = z.infer<typeof stepSchema>;

export const reentrySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('once') }),
  z.object({ mode: z.literal('cooldown'), days: z.number().int().min(1).max(3650) }),
]);

export type Reentry = z.infer<typeof reentrySchema>;

export const definitionSchema = z
  .object({
    description: z.string().max(1000).default(''),
    trigger: triggerSchema,
    /** Only enroll when ALL of these match at enrollment time. */
    enrollIf: z.array(conditionSchema).max(10).default([]),
    /** Leave the journey when ANY of these match (checked before every step). */
    exitIf: z.array(conditionSchema).max(10).default([]),
    reentry: reentrySchema.default({ mode: 'once' }),
    /** Run when someone finishes or leaves (e.g. remove the discount tag). */
    onEnd: z.array(actionSchema).max(5).default([]),
    /** Momence tag written after the final step (visible to staff). */
    completionTag: z.string().trim().max(80).optional(),
    steps: z.array(stepSchema).max(30),
  })
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    def.steps.forEach((step, i) => {
      if (seen.has(step.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'key'],
          message: `Duplicate step key "${step.key}"`,
        });
      }
      seen.add(step.key);
    });

    const needsSession = [...def.enrollIf, ...def.exitIf, ...def.steps.flatMap((s) => s.skipIf)]
      .filter((c) => CONDITIONS[c.type].needsSession)
      .map((c) => c.type);
    if (needsSession.length > 0 && def.trigger.type !== 'session-booked') {
      ctx.addIssue({
        code: 'custom',
        path: ['trigger'],
        message: `"${CONDITIONS[needsSession[0]].label}" only works for journeys triggered by a booking`,
      });
    }

    for (const c of [...def.enrollIf, ...def.exitIf, ...def.steps.flatMap((s) => s.skipIf)]) {
      const param = CONDITIONS[c.type].param;
      if (param === 'tag' && !c.tag) {
        ctx.addIssue({
          code: 'custom',
          path: ['conditions'],
          message: 'A tag condition needs a tag',
        });
      }
      if (param === 'count' && c.count == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['conditions'],
          message: 'A visit-count condition needs a number',
        });
      }
    }
  });

export type JourneyDefinition = z.infer<typeof definitionSchema>;

export const JOURNEY_ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

/** What the engine and the admin UI work with: the row plus its parsed definition. */
export interface JourneyRecord {
  id: string;
  name: string;
  enabled: boolean;
  /** Test mode: only whitelisted addresses enroll or receive. */
  testMode: boolean;
  archived: boolean;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
  definition: JourneyDefinition;
}

export function describeCondition(c: Condition): string {
  const meta = CONDITIONS[c.type];
  const base = c.negate ? meta.negatedLabel : meta.label;
  if (meta.param === 'tag') return `${base} "${c.tag ?? ''}"`;
  if (meta.param === 'count') return `${base} ${c.count ?? ''}`;
  return base;
}

/** "4 hours after the session ends", "2 days before intro expiry". */
export function describeTiming(t: StepTiming, sessionTrigger = false): string {
  const abs = Math.abs(t.offsetHours);
  const amount =
    abs === 0
      ? ''
      : abs % 24 === 0
        ? `${abs / 24} ${abs / 24 === 1 ? 'day' : 'days'}`
        : `${abs} ${abs === 1 ? 'hour' : 'hours'}`;
  const anchor =
    t.anchor === 'trigger'
      ? sessionTrigger
        ? 'the session ends'
        : 'enrollment'
      : t.anchor === 'previous'
        ? 'the previous email'
        : 'intro expiry';
  if (!amount) {
    if (t.anchor === 'previous') return 'Right after the previous email';
    return t.anchor === 'trigger' && sessionTrigger ? 'When the session ends' : `At ${anchor}`;
  }
  return `${amount} ${t.offsetHours < 0 ? 'before' : 'after'} ${anchor}`;
}
