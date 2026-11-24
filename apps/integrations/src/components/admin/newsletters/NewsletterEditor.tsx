// One newsletter: the campaign and list it goes to, the email itself (the
// journey block editor), a live preview as one person would get it, a test
// send, and the send itself: now or at a set time, behind a confirm that says
// how many people it will reach. Once it is sending it can't be edited, only
// stopped; progress refreshes while it goes out.

import { useEffect, useId, useRef, useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { BlockEditor } from '@/components/admin/journeys/BlockEditor';
import { Field, Section } from '@/components/admin/journeys/Field';
import {
  badgeClass,
  buttonClass,
  compactInputClass,
  goldButtonClass,
  inputClass,
  selectClass,
} from '@/components/admin/journeys/journeyUi';
import { Modal, modalPanelClass } from '@/components/admin/Modal';
import { ApiError, sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { BlockContent } from '@/lib/email/journeys/schema';
import type {
  NewsletterDetailResponse,
  NewsletterDto,
  NewsletterList,
  NewsletterPreviewResponse,
} from '@/lib/email/newsletter/api-types';
import { fmtWhen, LIST_LABELS, statusLabel } from './newsletterUi';

const errorText = (e: unknown) =>
  e instanceof ApiError || e instanceof Error ? e.message : String(e);

interface Draft {
  campaign: string;
  list: NewsletterList;
  content: BlockContent;
}

const draftOf = (issue: NewsletterDto): Draft => ({
  campaign: issue.campaign,
  list: issue.list,
  content: issue.content,
});

export function NewsletterEditor({ newsletterId }: { newsletterId: string }) {
  const url = `/api/admin/newsletters/${newsletterId}`;
  const { data, error, reload, setData } = useCachedJson<NewsletterDetailResponse>(url);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const campaignsId = useId();

  // Take the server's copy when it first arrives, and whenever the issue
  // stops being a draft (nothing local to keep then).
  const issue = data?.issue;
  useEffect(() => {
    if (!issue) return;
    if (draft === null || issue.status !== 'draft') {
      setDraft(draftOf(issue));
      setSaved(JSON.stringify(draftOf(issue)));
    }
  }, [issue, draft]);

  // Progress refreshes while it is going out.
  useEffect(() => {
    if (issue?.status !== 'sending') return;
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [issue?.status, reload]);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data || !issue || !draft) return <p className="text-sm text-white/50">Loading...</p>;

  const editable = issue.status === 'draft';
  const dirty = editable && JSON.stringify(draft) !== saved;
  const reach = data.audience[draft.list].reachable;
  const status = statusLabel(issue);

  const apply = (next: NewsletterDto) => {
    setData({ ...data, issue: next });
    setDraft(draftOf(next));
    setSaved(JSON.stringify(draftOf(next)));
    invalidateJson('/api/admin/newsletters');
  };

  const save = async (): Promise<boolean> => {
    setSaving(true);
    setActionError(null);
    try {
      const result = await sendJson<{ issue: NewsletterDto }>(url, 'PATCH', draft);
      apply(result.issue);
      return true;
    } catch (e) {
      setActionError(errorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    setConfirming(false);
    if (dirty && !(await save())) return;
    setSaving(true);
    setActionError(null);
    try {
      const result = await sendJson<{ issue: NewsletterDto; run?: { error?: string } }>(
        `${url}/send`,
        'POST',
        { sendAfter: sendAt ? new Date(sendAt).toISOString() : null }
      );
      apply(result.issue);
      if (result.run?.error) setActionError(result.run.error);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const stop = async () => {
    setSaving(true);
    setActionError(null);
    try {
      apply((await sendJson<{ issue: NewsletterDto }>(`${url}/cancel`, 'POST', {})).issue);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this draft?')) return;
    try {
      await sendJson(url, 'DELETE');
      invalidateJson('/api/admin/newsletters');
      window.location.href = '/admin/newsletters';
    } catch (e) {
      setActionError(errorText(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/admin/newsletters" className="text-sm text-white/50 hover:text-white">
            All newsletters
          </a>
          <span className={badgeClass(status.tone)}>{status.text}</span>
          {dirty && <span className="text-xs text-white/45">Unsaved changes</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <button type="button" className={buttonClass} onClick={() => void remove()}>
                Delete draft
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {issue.lastError && issue.status === 'sending' && (
        <ErrorBanner>
          The last send attempt stopped: {issue.lastError} It will try again on the next hourly run.
        </ErrorBanner>
      )}

      {issue.status !== 'draft' && <Progress issue={issue} reach={reach} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-4">
          <Section number={1} title="Who it goes to">
            <Field
              label="List"
              htmlFor="newsletter-list"
              hint={`${data.audience[draft.list].subscribers} on the list; ${reach} will get it. The rest have unsubscribed, bounced or complained.`}
            >
              <select
                id="newsletter-list"
                className={selectClass}
                value={draft.list}
                onChange={(e) => setDraft({ ...draft, list: e.target.value as NewsletterList })}
              >
                {(Object.keys(LIST_LABELS) as NewsletterList[]).map((list) => (
                  <option key={list} value={list}>
                    {LIST_LABELS[list]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Campaign"
              htmlFor="newsletter-campaign"
              tip="Every link in the email carries this as utm_campaign, so visits and bookings from it show up on that campaign in the Campaigns tool."
              hint="Lowercase letters, numbers and dashes, like newsletter-2026-12."
            >
              <input
                id="newsletter-campaign"
                className={inputClass}
                list={campaignsId}
                value={draft.campaign}
                onChange={(e) => setDraft({ ...draft, campaign: e.target.value })}
              />
              <datalist id={campaignsId}>
                {data.campaigns.map((slug) => (
                  <option key={slug} value={slug} />
                ))}
              </datalist>
            </Field>
          </Section>

          <Section
            number={2}
            title="The email"
            description="Only {{firstName|fallback}} can be filled in for each person. Everything else is the same for everyone."
          >
            <BlockEditor
              content={draft.content}
              onChange={(content) => setDraft({ ...draft, content })}
              campaign={draft.campaign}
              stepKey="newsletter"
            />
          </Section>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-4">
          <Section number={3} title="Preview and test">
            <Preview newsletterId={newsletterId} draft={draft} />
          </Section>

          {editable && (
            <Section
              number={4}
              title="Send"
              description={
                data.canSend
                  ? undefined
                  : 'Only an admin can send a newsletter. Save it and ask one to send it.'
              }
            >
              {!data.templateLive && (
                <ErrorBanner>
                  The newsletter template is not live, so nothing would go out. Turn on "newsletter"
                  in{' '}
                  <a href="/admin/email-templates" className="underline">
                    Email Templates
                  </a>{' '}
                  first.
                </ErrorBanner>
              )}
              <Field
                label="When"
                htmlFor="newsletter-send-at"
                hint="Leave empty to send now. A set time starts on the first hourly run after it."
              >
                <input
                  id="newsletter-send-at"
                  type="datetime-local"
                  className={inputClass}
                  value={sendAt}
                  onChange={(e) => setSendAt(e.target.value)}
                />
              </Field>
              <button
                type="button"
                className={goldButtonClass}
                disabled={!data.canSend || !data.templateLive || saving || reach === 0}
                onClick={() => setConfirming(true)}
              >
                {sendAt ? 'Schedule' : 'Send now'}
              </button>
            </Section>
          )}

          {issue.status === 'sending' && data.canSend && (
            <button
              type="button"
              className={buttonClass}
              disabled={saving}
              onClick={() => void stop()}
            >
              {issue.startedAt ? 'Stop sending' : 'Unschedule'}
            </button>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmSend
          subject={draft.content.subject}
          reach={reach}
          sendAt={sendAt}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      )}
    </div>
  );
}

function Progress({ issue, reach }: { issue: NewsletterDto; reach: number }) {
  const scheduled =
    issue.status === 'sending' &&
    !issue.startedAt &&
    issue.sendAfter &&
    new Date(issue.sendAfter).getTime() > Date.now();
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 rounded border border-white/10 bg-white/[0.03] p-3 text-sm">
      {scheduled && issue.sendAfter ? (
        <span>Scheduled for {fmtWhen(issue.sendAfter)} (Eastern)</span>
      ) : (
        <>
          <span>
            <strong>{issue.sentCount}</strong>
            {issue.status === 'sending' ? ` of about ${reach}` : ''} sent
          </span>
          <span className="text-white/55">{issue.suppressedCount} skipped (unsubscribed)</span>
          {issue.failedCount > 0 && (
            <span className="text-[var(--pyre-red)]">{issue.failedCount} refused by Resend</span>
          )}
          {issue.finishedAt && (
            <span className="text-white/55">
              {issue.status === 'cancelled' ? 'Stopped' : 'Finished'} {fmtWhen(issue.finishedAt)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function Preview({ newsletterId, draft }: { newsletterId: string; draft: Draft }) {
  const [preview, setPreview] = useState<NewsletterPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testState, setTestState] = useState<string | null>(null);
  const seq = useRef(0);
  const body = JSON.stringify({ content: draft.content, campaign: draft.campaign, firstName });

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await sendJson<NewsletterPreviewResponse>(
          `/api/admin/newsletters/${newsletterId}/preview`,
          'POST',
          JSON.parse(body)
        );
        if (mine !== seq.current) return;
        setPreview(result);
        setError(null);
      } catch (e) {
        if (mine === seq.current) setError(errorText(e));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [newsletterId, body]);

  const sendTest = async () => {
    setTestState('Sending...');
    try {
      const result = await sendJson<{ to: string }>(
        `/api/admin/newsletters/${newsletterId}/test-send`,
        'POST',
        { ...JSON.parse(body), to: testTo }
      );
      setTestState(`Sent to ${result.to}`);
    } catch (e) {
      setTestState(errorText(e));
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Field
        label="Preview as"
        htmlFor="newsletter-preview-name"
        hint="A first name to fill in. Leave empty to see the fallback."
      >
        <input
          id="newsletter-preview-name"
          className={compactInputClass}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
      </Field>
      {error && <ErrorBanner mono>{error}</ErrorBanner>}
      {preview && preview.problems.length > 0 && (
        <ErrorBanner>
          This can't be sent yet:
          <ul className="mt-1 list-disc pl-5">
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </ErrorBanner>
      )}
      {preview && (
        <>
          <p className="truncate text-sm">
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              Subject{' '}
            </span>
            {preview.subject}
          </p>
          <iframe
            title="Newsletter preview"
            srcDoc={preview.html}
            sandbox=""
            className="h-[640px] w-full rounded border border-white/10 bg-white"
          />
        </>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className={`${compactInputClass} min-w-0 flex-1`}
          value={testTo}
          placeholder="you@pyresauna.com"
          onChange={(e) => setTestTo(e.target.value)}
          aria-label="Send a test to"
        />
        <button type="button" className={buttonClass} onClick={() => void sendTest()}>
          Send test
        </button>
      </div>
      <p className="text-xs text-white/45">
        A test has a real unsubscribe link: using it unsubscribes that address.
      </p>
      {testState && <p className="font-mono text-xs text-white/50">{testState}</p>}
    </div>
  );
}

function ConfirmSend({
  subject,
  reach,
  sendAt,
  onCancel,
  onConfirm,
}: {
  subject: string;
  reach: number;
  sendAt: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const headingId = useId();
  return (
    <Modal labelledBy={headingId} onClose={onCancel} panelClassName={`${modalPanelClass} max-w-md`}>
      <div className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="text-lg font-semibold">
          {sendAt ? 'Schedule this newsletter?' : 'Send this newsletter now?'}
        </h2>
        <p className="text-sm text-white/70">
          "{subject}" goes to <strong>{reach}</strong> people
          {sendAt ? `, starting ${fmtWhen(new Date(sendAt).toISOString())} (Eastern)` : ''}. It
          can't be edited after this, and emails already sent can't be taken back.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={goldButtonClass} onClick={onConfirm}>
            {sendAt ? 'Schedule' : `Send to ${reach}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
