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

/** How long after the last change a draft saves itself. */
const AUTOSAVE_MS = 1500;

// Every unsaved change is also kept in this browser, so a reload, a closed
// tab or a save the server refused (an empty subject, say) loses nothing.
// `base` is the server version it was written on top of: a backup is only
// restored onto that same version, never over someone else's later save.
interface Backup {
  draft: Draft;
  base: string;
}

const backupKey = (id: string) => `pyre:newsletter-draft:${id}`;

function readBackup(id: string): Backup | null {
  try {
    const raw = window.localStorage.getItem(backupKey(id));
    if (!raw) return null;
    const backup = JSON.parse(raw) as Partial<Backup>;
    const draft = backup.draft as Partial<Draft> | undefined;
    if (
      typeof backup.base !== 'string' ||
      typeof draft?.campaign !== 'string' ||
      typeof draft.list !== 'string' ||
      draft.content?.type !== 'blocks' ||
      !Array.isArray(draft.content.blocks)
    ) {
      return null;
    }
    return backup as Backup;
  } catch {
    return null;
  }
}

function writeBackup(id: string, backup: Backup | null) {
  try {
    if (backup) window.localStorage.setItem(backupKey(id), JSON.stringify(backup));
    else window.localStorage.removeItem(backupKey(id));
  } catch {
    // Storage full or blocked: the server copy is all there is.
  }
}

export function NewsletterEditor({ newsletterId }: { newsletterId: string }) {
  const url = `/api/admin/newsletters/${newsletterId}`;
  const { data, error, reload, setData } = useCachedJson<NewsletterDetailResponse>(url);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The draft as last saved, and the server version that save made. */
  const [saved, setSaved] = useState<{ json: string; base: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /** The draft the server last refused, so autosave doesn't retry it until it changes. */
  const [refused, setRefused] = useState<{ json: string; error: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const campaignsId = useId();

  const issue = data?.issue;
  const draftJson = draft ? JSON.stringify(draft) : '';
  const editable = issue?.status === 'draft';
  const dirty = Boolean(editable && draft && saved && draftJson !== saved.json);

  // Take the server's copy when it first arrives (picking up a backup of
  // unsaved changes made on top of it), when a newer version arrives and
  // nothing here is unsaved (a cached copy replaced by the fresh one), and
  // whenever the issue stops being a draft.
  useEffect(() => {
    if (!issue) return;
    const server = draftOf(issue);
    const serverJson = JSON.stringify(server);
    if (draft === null) {
      const backup = issue.status === 'draft' ? readBackup(newsletterId) : null;
      const usable =
        backup && backup.base === issue.updatedAt && JSON.stringify(backup.draft) !== serverJson;
      if (!usable) writeBackup(newsletterId, null);
      setDraft(usable ? backup.draft : server);
      setRestored(Boolean(usable));
      setSaved({ json: serverJson, base: issue.updatedAt });
      return;
    }
    // Only for a version not yet taken, or this would run on every render.
    if (saved?.base !== issue.updatedAt && (issue.status !== 'draft' || !dirty)) {
      setDraft(server);
      setSaved({ json: serverJson, base: issue.updatedAt });
    }
  }, [issue, draft, dirty, saved, newsletterId]);

  // Back up unsaved changes in this browser; drop the backup once saved.
  useEffect(() => {
    if (!draft || !saved || !editable) return;
    writeBackup(newsletterId, dirty ? { draft, base: saved.base } : null);
  }, [draft, saved, dirty, editable, newsletterId]);

  const save = async (): Promise<boolean> => {
    if (!draft || !data) return false;
    const json = JSON.stringify(draft);
    setSaving(true);
    try {
      const result = await sendJson<{ issue: NewsletterDto }>(url, 'PATCH', draft);
      // Only the saved marker moves: the draft itself stays as typed, so
      // nothing typed while the save was on its way is lost.
      setSaved({ json, base: result.issue.updatedAt });
      setRefused(null);
      setData((prev) => (prev ? { ...prev, issue: result.issue } : prev));
      invalidateJson('/api/admin/newsletters');
      return true;
    } catch (e) {
      setRefused({ json, error: errorText(e) });
      // No longer a draft (sent from another tab): show what it is now.
      if (e instanceof ApiError && (e.status === 409 || e.status === 404)) void reload();
      return false;
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Save a moment after typing stops, one save at a time.
  useEffect(() => {
    if (!dirty || saving || refused?.json === draftJson) return;
    const timer = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, saving, refused, draftJson]);

  // Leaving the page inside the autosave wait: send what is left on the way out.
  const pending = useRef<string | null>(null);
  pending.current = dirty && refused?.json !== draftJson ? draftJson : null;
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      void fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: pending.current,
        keepalive: true,
      }).catch(() => {
        // Too big for a keepalive request, or offline: the backup has it.
      });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [url]);

  // Progress refreshes while it is going out.
  useEffect(() => {
    if (issue?.status !== 'sending') return;
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [issue?.status, reload]);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data || !issue || !draft) return <p className="text-sm text-white/50">Loading...</p>;

  const reach = data.audience[draft.list].reachable;
  const status = statusLabel(issue);

  const apply = (next: NewsletterDto) => {
    setData({ ...data, issue: next });
    setDraft(draftOf(next));
    setSaved({ json: JSON.stringify(draftOf(next)), base: next.updatedAt });
    invalidateJson('/api/admin/newsletters');
  };

  const discardRestored = () => {
    setRestored(false);
    setRefused(null);
    setDraft(draftOf(issue));
  };

  const saveState = !editable
    ? null
    : saving
      ? 'Saving...'
      : refused && refused.json === draftJson
        ? `Not saved: ${refused.error} Your changes are kept in this browser until it can be.`
        : dirty
          ? 'Unsaved changes'
          : 'All changes saved';

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
      writeBackup(newsletterId, null);
      pending.current = null;
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
          {saveState && (
            <span role="status" className="text-xs text-white/45">
              {saveState}
            </span>
          )}
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
                Save now
              </button>
            </>
          )}
        </div>
      </div>

      {restored && editable && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.03] p-3 text-sm">
          <span>Picked up the changes you hadn't saved yet in this browser.</span>
          <button type="button" className={buttonClass} onClick={discardRestored}>
            Discard them
          </button>
        </div>
      )}
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
              logoPicker
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
                  : 'Only an admin can send a newsletter. It saves as you go; ask one to send it.'
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
