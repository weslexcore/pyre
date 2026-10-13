// Shared bits for the /admin/journeys islands: small style strings, the
// plain-language summaries, and the starting shapes for new steps and blocks.
// Client-bundle-safe — imports only the schema module (zod + constants).

import {
  type Condition,
  describeCondition,
  type EmailBlock,
  type EmailBlockType,
  type JourneyDefinition,
  type JourneyStep,
  STEP_KEY_RE,
  TRIGGERS,
  type Trigger,
} from '@/lib/email/journeys/schema';

export {
  buttonClass,
  cardClass,
  compactInputClass,
  compactSelectClass,
  goldButtonClass,
  inputClass,
  labelClass,
  microLabelClass,
  selectClass,
} from '@/components/admin/ui';

export const sectionHeading = 'font-mono text-xs font-bold uppercase tracking-wide text-white/40';

export const pillClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

export const badgeClass = (tone: 'on' | 'off' | 'test' | 'warn') =>
  `inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
    {
      on: 'border-emerald-400/40 text-emerald-400',
      off: 'border-white/20 text-white/40',
      test: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
      warn: 'border-[var(--pyre-red)]/50 text-[var(--pyre-red)]',
    }[tone]
  }`;

export function describeTrigger(trigger: Trigger): string {
  switch (trigger.type) {
    case 'session-booked':
      return trigger.firstBookingOnly ? 'Books their first session' : 'Books any session';
    case 'sweep': {
      const parts: string[] = [];
      if (trigger.inactiveDays && trigger.maxInactiveDays) {
        parts.push(`last seen ${trigger.inactiveDays}-${trigger.maxInactiveDays} days ago`);
      } else if (trigger.inactiveDays) {
        parts.push(`not seen for ${trigger.inactiveDays} days`);
      } else if (trigger.maxInactiveDays) {
        parts.push(`seen in the last ${trigger.maxInactiveDays} days`);
      }
      if (trigger.minVisits) parts.push(`${trigger.minVisits}+ visits`);
      if (trigger.withTags.length) parts.push(`tagged ${trigger.withTags.join(', ')}`);
      if (trigger.withoutTags.length) parts.push(`not tagged ${trigger.withoutTags.join(', ')}`);
      return parts.length ? `Audience: ${parts.join(', ')}` : 'Audience: every customer';
    }
    case 'manual':
      return TRIGGERS.manual.label;
  }
}

export function describeConditions(conditions: Condition[], joiner: 'and' | 'or'): string {
  return conditions.map(describeCondition).join(joiner === 'and' ? ' and ' : ' or ');
}

export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

export function slugify(value: string, max = 48): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** A step key not already used in the journey. */
export function uniqueStepKey(base: string, steps: JourneyStep[]): string {
  const root = slugify(base, 40) || 'step';
  const taken = new Set(steps.map((s) => s.key));
  if (!taken.has(root) && STEP_KEY_RE.test(root)) return root;
  for (let i = 2; ; i += 1) {
    const key = `${root}-${i}`;
    if (!taken.has(key)) return key;
  }
}

export function newStep(steps: JourneyStep[]): JourneyStep {
  return {
    key: uniqueStepKey(`email-${steps.length + 1}`, steps),
    name: `Email ${steps.length + 1}`,
    archived: false,
    timing: { anchor: steps.length === 0 ? 'trigger' : 'previous', offsetHours: 24 },
    skipIf: [],
    actions: [],
    content: {
      type: 'blocks',
      subject: 'A note from Pyre',
      preview: '',
      background: 'trees',
      blocks: [
        { type: 'heading', text: 'Hi {{firstName|there}}' },
        { type: 'paragraph', text: '' },
        { type: 'button', label: 'Book a session', url: 'https://pyresauna.com/events' },
        { type: 'signoff', text: 'Wes + Julien' },
      ],
    },
  };
}

export const BLOCK_LABELS: Record<EmailBlockType, string> = {
  heading: 'Heading',
  paragraph: 'Text',
  list: 'Bullet list',
  button: 'Button',
  divider: 'Divider',
  image: 'Image',
  signoff: 'Sign-off',
};

export function newBlock(type: EmailBlockType): EmailBlock {
  switch (type) {
    case 'heading':
      return { type, text: '' };
    case 'paragraph':
      return { type, text: '' };
    case 'list':
      return { type, items: [''] };
    case 'button':
      return { type, label: 'Book a session', url: 'https://pyresauna.com/events' };
    case 'divider':
      return { type };
    case 'image':
      return { type, src: '', alt: '' };
    case 'signoff':
      return { type, text: 'Wes + Julien' };
  }
}

export function blankDefinition(trigger: Trigger['type']): JourneyDefinition {
  const triggerValue: Trigger =
    trigger === 'session-booked'
      ? { type: 'session-booked', firstBookingOnly: false }
      : trigger === 'sweep'
        ? { type: 'sweep', withTags: [], withoutTags: [] }
        : { type: 'manual' };
  return {
    description: '',
    trigger: triggerValue,
    enrollIf: [],
    exitIf: [],
    reentry: { mode: 'once' },
    onEnd: [],
    steps: [newStep([])],
  };
}
