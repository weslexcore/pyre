// /admin/newsletters: every issue, newest first, with how far its send got,
// and the size of the mailing list. A new issue starts as a draft for this
// month (next month from the 20th) and opens in the editor.

import { useState } from 'react';
import { ErrorBanner } from '@/components/admin/ErrorBanner';
import { badgeClass, cardClass, goldButtonClass } from '@/components/admin/journeys/journeyUi';
import { sendJson } from '@/lib/client/api';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type { NewsletterDto, NewsletterListResponse } from '@/lib/email/newsletter/api-types';
import { fmtWhen, statusLabel } from './newsletterUi';

const LIST_URL = '/api/admin/newsletters';

export function NewslettersIndex() {
  const { data, error } = useCachedJson<NewsletterListResponse>(LIST_URL);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const { issue } = await sendJson<{ issue: NewsletterDto }>(LIST_URL, 'POST', {});
      invalidateJson(LIST_URL);
      window.location.href = `/admin/newsletters/${issue.id}`;
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-white/60">
          Each issue goes to everyone on the mailing list, one email per person, with their own
          unsubscribe link. Anyone who has unsubscribed, bounced or complained is skipped.
        </p>
        <button
          type="button"
          className={goldButtonClass}
          disabled={creating}
          onClick={() => void create()}
        >
          {creating ? 'Starting...' : 'New newsletter'}
        </button>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {createError && <ErrorBanner>{createError}</ErrorBanner>}

      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={cardClass}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              Mailing list
            </p>
            <p className="text-2xl font-semibold">{data.audience.newsletter.subscribers}</p>
          </div>
          <div className={cardClass}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              An issue reaches
            </p>
            <p className="text-2xl font-semibold">{data.audience.newsletter.reachable}</p>
            <p className="text-xs text-white/45">The rest have unsubscribed or bounced.</p>
          </div>
          <div className={cardClass}>
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              Volunteers
            </p>
            <p className="text-2xl font-semibold">{data.audience.volunteer.subscribers}</p>
          </div>
        </div>
      )}

      {data && !data.templateLive && (
        <ErrorBanner>
          The newsletter template is not live here, so nothing can be sent yet. Turn on "newsletter"
          in{' '}
          <a href="/admin/email-templates" className="underline">
            Email Templates
          </a>{' '}
          when the first issue is ready.
        </ErrorBanner>
      )}

      {data && data.issues.length === 0 && (
        <p className="text-sm text-white/50">No newsletters yet.</p>
      )}

      {data && data.issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.issues.map((issue) => {
            const status = statusLabel(issue);
            return (
              <li key={issue.id}>
                <a
                  href={`/admin/newsletters/${issue.id}`}
                  className={`${cardClass} flex flex-wrap items-center justify-between gap-3 hover:border-white/30`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{issue.content.subject}</p>
                    <p className="font-mono text-xs text-white/45">{issue.campaign}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/55">
                    {issue.status !== 'draft' && <span>{issue.sentCount} sent</span>}
                    {status.text === 'Scheduled' && issue.sendAfter && (
                      <span>{fmtWhen(issue.sendAfter)}</span>
                    )}
                    {issue.finishedAt && <span>{fmtWhen(issue.finishedAt)}</span>}
                    <span className={badgeClass(status.tone)}>{status.text}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
