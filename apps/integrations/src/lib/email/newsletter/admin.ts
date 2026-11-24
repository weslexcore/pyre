import { utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type BlockContent, blockContentSchema } from '@/lib/email/journeys/schema';
import { loadSuppressedEmails } from '../resend-sync';
import type { AudienceCount, NewsletterDto, NewsletterList, NewsletterStatus } from './api-types';
import { newsletterProblems } from './content';

// The store behind /admin/newsletters: issues and the mailing list counts.
// Only a draft can be edited or deleted; sending flips it to 'sending' and the
// send job (./send-job.ts) takes it from there.

export const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const NEWSLETTER_LISTS: readonly NewsletterList[] = ['newsletter', 'volunteer'];

const COLUMNS =
  'id, campaign, list, content, status, send_after, sent_count, suppressed_count, failed_count, last_error, started_at, finished_at, created_by, created_at, updated_at';

interface Row {
  id: string;
  campaign: string;
  list: NewsletterList;
  content: unknown;
  status: NewsletterStatus;
  send_after: string | null;
  sent_count: number;
  suppressed_count: number;
  failed_count: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toDto(row: Row): NewsletterDto {
  const parsed = blockContentSchema.safeParse(row.content);
  return {
    id: row.id,
    campaign: row.campaign,
    list: row.list,
    content: parsed.success ? parsed.data : defaultContent(),
    status: row.status,
    sendAfter: row.send_after,
    sentCount: row.sent_count,
    suppressedCount: row.suppressed_count,
    failedCount: row.failed_count,
    lastError: row.last_error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The month an issue written now is for: this one until the 20th, then the next. */
function issueMonth(now: Date): { year: number; month: number } {
  const [year, month, day] = utcToEastern(now.toISOString()).date.split('-').map(Number);
  if (day < 20) return { year, month };
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function defaultCampaign(now: Date): string {
  const { year, month } = issueMonth(now);
  return `newsletter-${year}-${String(month).padStart(2, '0')}`;
}

export function defaultContent(now: Date = new Date()): BlockContent {
  const { month } = issueMonth(now);
  return {
    type: 'blocks',
    subject: `${MONTHS[month - 1]} at Pyre`,
    preview: '',
    background: 'clouds',
    blocks: [
      { type: 'heading', text: 'Hi {{firstName|there}},' },
      { type: 'paragraph', text: '' },
      { type: 'signoff', text: 'Wes + Julien' },
    ],
  };
}

export async function listIssues(db: SupabaseClient): Promise<NewsletterDto[]> {
  const { data, error } = await db
    .from('newsletters')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not read newsletters: ${error.message}`);
  return ((data ?? []) as Row[]).map(toDto);
}

export async function getIssue(db: SupabaseClient, id: string): Promise<NewsletterDto | null> {
  const { data, error } = await db.from('newsletters').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not read the newsletter: ${error.message}`);
  return data ? toDto(data as Row) : null;
}

/** Who is on each list, and who an issue would actually reach. */
export async function audienceCounts(
  db: SupabaseClient
): Promise<Record<NewsletterList, AudienceCount>> {
  const suppressed = await loadSuppressedEmails(db);
  const counts: Record<NewsletterList, AudienceCount> = {
    newsletter: { subscribers: 0, reachable: 0 },
    volunteer: { subscribers: 0, reachable: 0 },
  };
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('newsletter_subscribers')
      .select('email, lists')
      .order('email')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read the mailing list: ${error.message}`);
    for (const row of (data ?? []) as { email: string; lists: string[] }[]) {
      for (const list of NEWSLETTER_LISTS) {
        if (!row.lists.includes(list)) continue;
        counts[list].subscribers++;
        if (!suppressed.has(row.email)) counts[list].reachable++;
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return counts;
}

export type StoreResult =
  | { ok: true; issue: NewsletterDto }
  | { ok: false; status: number; error: string };

export async function createIssue(db: SupabaseClient, actor: string): Promise<StoreResult> {
  const now = new Date();
  const { data, error } = await db
    .from('newsletters')
    .insert({ campaign: defaultCampaign(now), content: defaultContent(now), created_by: actor })
    .select(COLUMNS)
    .single();
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, issue: toDto(data as Row) };
}

export interface DraftInput {
  campaign?: unknown;
  list?: unknown;
  content?: unknown;
}

/** Checks a draft's fields; the content only has to be well formed, not ready to send. */
export function parseDraft(
  input: DraftInput
):
  | { ok: true; draft: { campaign?: string; list?: NewsletterList; content?: BlockContent } }
  | { ok: false; error: string } {
  const draft: { campaign?: string; list?: NewsletterList; content?: BlockContent } = {};
  if (input.campaign !== undefined) {
    const campaign = typeof input.campaign === 'string' ? input.campaign.trim() : '';
    if (!CAMPAIGN_RE.test(campaign)) {
      return {
        ok: false,
        error:
          'The campaign must be lowercase letters, numbers and dashes, like newsletter-2026-12.',
      };
    }
    draft.campaign = campaign;
  }
  if (input.list !== undefined) {
    if (!NEWSLETTER_LISTS.includes(input.list as NewsletterList)) {
      return { ok: false, error: 'Unknown list' };
    }
    draft.list = input.list as NewsletterList;
  }
  if (input.content !== undefined) {
    const parsed = blockContentSchema.safeParse(input.content);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
    }
    draft.content = parsed.data;
  }
  return { ok: true, draft };
}

/** Saves a draft. Refused once it is sending or done, so what goes out is what was approved. */
export async function saveDraft(
  db: SupabaseClient,
  id: string,
  draft: { campaign?: string; list?: NewsletterList; content?: BlockContent }
): Promise<StoreResult> {
  const { data, error } = await db
    .from('newsletters')
    .update(draft)
    .eq('id', id)
    .eq('status', 'draft')
    .select(COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return notDraft(db, id);
  return { ok: true, issue: toDto(data as Row) };
}

async function notDraft(db: SupabaseClient, id: string): Promise<StoreResult> {
  const issue = await getIssue(db, id);
  if (!issue) return { ok: false, status: 404, error: 'This newsletter no longer exists.' };
  return {
    ok: false,
    status: 409,
    error: `This newsletter is ${issue.status === 'sending' ? 'already sending' : issue.status}, so it can't be changed.`,
  };
}

export async function deleteDraft(db: SupabaseClient, id: string): Promise<StoreResult | null> {
  const { data, error } = await db
    .from('newsletters')
    .delete()
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data || data.length === 0) return notDraft(db, id);
  return null;
}

/**
 * Approves a draft for sending: now, or from `sendAfter`. Refuses content
 * the send would refuse, so problems show up here and not an hour later.
 */
export async function approveSend(
  db: SupabaseClient,
  id: string,
  sendAfter: string | null
): Promise<StoreResult> {
  const issue = await getIssue(db, id);
  if (!issue) return { ok: false, status: 404, error: 'This newsletter no longer exists.' };
  if (issue.status !== 'draft') return notDraft(db, id);
  const problems = newsletterProblems(issue.content);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join(' ') };

  const { data, error } = await db
    .from('newsletters')
    .update({ status: 'sending', send_after: sendAfter, last_error: null })
    .eq('id', id)
    .eq('status', 'draft')
    .select(COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return notDraft(db, id);
  return { ok: true, issue: toDto(data as Row) };
}

/**
 * Stops a send. Copies already sent stay sent; the job stops at its next
 * batch. A scheduled issue that hasn't started goes back to being a draft.
 */
export async function cancelSend(db: SupabaseClient, id: string): Promise<StoreResult> {
  const issue = await getIssue(db, id);
  if (!issue) return { ok: false, status: 404, error: 'This newsletter no longer exists.' };
  if (issue.status !== 'sending') {
    return { ok: false, status: 409, error: `This newsletter is ${issue.status}, not sending.` };
  }
  const backToDraft = !issue.startedAt;
  const { data, error } = await db
    .from('newsletters')
    .update(
      backToDraft
        ? { status: 'draft', send_after: null }
        : { status: 'cancelled', finished_at: new Date().toISOString() }
    )
    .eq('id', id)
    .eq('status', 'sending')
    .select(COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data)
    return { ok: false, status: 409, error: 'The send finished before it could be stopped.' };
  return { ok: true, issue: toDto(data as Row) };
}
