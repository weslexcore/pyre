import { render } from '@react-email/components';
import { type ComponentType, createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { Db } from '@/lib/http/route';
import { fetchTagMap, findMemberByEmail } from '@/lib/momence/host-api';
import { buildContext, mergeValues } from './context';
import { fillContent, type MergeValues, sampleMergeValues, usedFields } from './merge-fields';
import type { JourneyDefinition, StepContent } from './schema';
import { isTemplateStepKey } from './store';

// Server-side pieces behind /admin/journeys: rendering a step as it would
// send (sample or live member data), the list page's numbers, and the tag
// check that warns about actions pointing at tags Momence doesn't have.

export interface RenderedStep {
  subject: string;
  html: string;
  /** Merge fields with no value and no fallback — the step would be skipped. */
  missing: string[];
  values: MergeValues;
}

const PREVIEW_UNSUBSCRIBE = 'https://pyre-integrations.vercel.app/api/unsubscribe?token=preview';

/**
 * Render step content. With `memberEmail`, merge fields come from that
 * member's live Momence data; otherwise from the catalog's samples.
 */
export async function renderStep(
  journeyId: string,
  content: StepContent,
  { memberEmail }: { memberEmail?: string } = {}
): Promise<RenderedStep | { error: string }> {
  if (content.type === 'none') return { error: 'This step sends no email' };

  let values: MergeValues = sampleMergeValues();
  if (memberEmail) {
    const member = await findMemberByEmail(memberEmail);
    if (!member) return { error: `No Momence customer with the email ${memberEmail}` };
    const ctx = buildContext(
      {
        memberId: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
      },
      { member }
    );
    values =
      content.type === 'blocks'
        ? await mergeValues(ctx, usedFields(content))
        : { firstName: member.firstName };
  }

  if (content.type === 'template') {
    if (!isTemplateStepKey(content.key)) return { error: `Unknown template "${content.key}"` };
    const entry = EMAIL_TEMPLATES[content.key] as unknown as {
      subject: (props: Record<string, unknown>) => string;
      Component: ComponentType<Record<string, unknown>>;
    };
    const props = {
      firstName: values.firstName ?? 'there',
      reviewUrl: 'https://g.page/r/CbPLgfm6vte6EAI/review',
      unsubscribeUrl: PREVIEW_UNSUBSCRIBE,
    };
    return {
      subject: entry.subject(props),
      html: await render(createElement(entry.Component, props)),
      missing: [],
      values,
    };
  }

  const { content: filled, missing } = fillContent(content, values);
  const props = {
    firstName: values.firstName ?? '',
    subject: filled.subject,
    preview: filled.preview,
    background: filled.background,
    blocks: filled.blocks,
    campaign: journeyId,
    unsubscribeUrl: PREVIEW_UNSUBSCRIBE,
  };
  return {
    subject: EMAIL_TEMPLATES.journey.subject(props),
    html: await render(createElement(EMAIL_TEMPLATES.journey.Component, props)),
    missing,
    values,
  };
}

// --- List stats ---

export interface JourneyStats {
  active: number;
  completed: number;
  exited: number;
  /** Last 30 days. */
  sent30d: number;
  delivered30d: number;
  opened30d: number;
  clicked30d: number;
}

const emptyStats = (): JourneyStats => ({
  active: 0,
  completed: 0,
  exited: 0,
  sent30d: 0,
  delivered30d: 0,
  opened30d: 0,
  clicked30d: 0,
});

export async function journeyStats(db: Db): Promise<Record<string, JourneyStats>> {
  const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const [enrollments, sends] = await Promise.all([
    db.from('journey_enrollments').select('journey_id, status').limit(50_000),
    db
      .from('email_sends')
      .select('journey_id, delivered_at, opened_at, clicked_at')
      .not('journey_id', 'is', null)
      .eq('status', 'sent')
      .gte('sent_at', since)
      .limit(50_000),
  ]);
  if (enrollments.error) throw new Error(enrollments.error.message);
  if (sends.error) throw new Error(sends.error.message);

  const stats: Record<string, JourneyStats> = {};
  for (const row of enrollments.data as {
    journey_id: string;
    status: 'active' | 'completed' | 'exited';
  }[]) {
    stats[row.journey_id] ??= emptyStats();
    stats[row.journey_id][row.status] += 1;
  }
  for (const row of sends.data as {
    journey_id: string;
    delivered_at: string | null;
    opened_at: string | null;
    clicked_at: string | null;
  }[]) {
    stats[row.journey_id] ??= emptyStats();
    const s = stats[row.journey_id];
    s.sent30d += 1;
    if (row.delivered_at) s.delivered30d += 1;
    if (row.opened_at) s.opened30d += 1;
    if (row.clicked_at) s.clicked30d += 1;
  }
  return stats;
}

// --- Tags ---

/** Tags a definition names (actions, completion, conditions, sweep filters). */
export function tagsIn(definition: JourneyDefinition): string[] {
  const tags = new Set<string>();
  const trigger = definition.trigger;
  if (trigger.type === 'sweep') {
    for (const t of [...trigger.withTags, ...trigger.withoutTags]) tags.add(t);
  }
  for (const a of [...definition.onEnd, ...definition.steps.flatMap((s) => s.actions)])
    tags.add(a.tag);
  if (definition.completionTag) tags.add(definition.completionTag);
  for (const c of [
    ...definition.enrollIf,
    ...definition.exitIf,
    ...definition.steps.flatMap((s) => s.skipIf),
  ]) {
    if (c.type === 'has-tag' && c.tag) tags.add(c.tag);
  }
  return [...tags];
}

/** Which of these tags Momence doesn't have (null when Momence can't be asked). */
export async function missingTags(tags: string[]): Promise<string[] | null> {
  if (tags.length === 0) return [];
  try {
    const map = await fetchTagMap();
    return tags.filter((t) => !(t.toLowerCase() in map));
  } catch {
    return null;
  }
}

export async function allTagNames(): Promise<string[]> {
  try {
    return Object.keys(await fetchTagMap()).sort();
  } catch {
    return [];
  }
}
