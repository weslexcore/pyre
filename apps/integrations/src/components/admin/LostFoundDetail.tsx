// One lost-and-found item: its photos, who has been asked, who claimed it, and
// everything that has happened to it.
//
// The page is ordered by what a staff member is here to do. Handing something
// back is the commonest reason this page is open at all — someone is at the
// desk, waiting — so picked up / donated / discarded sit directly under the
// title rather than at the bottom of everything. Then who claimed it, then the
// ask panel, because an item is only useful to its owner if its owner hears
// about it. The audit trail is last: it matters when something goes wrong, not
// when things are going right.

import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type {
  LostFoundAttachmentRow,
  LostFoundEventRow,
  LostFoundItemRow,
  LostFoundNoticeRow,
} from '@/lib/db';
import {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  MAX_ATTACHMENTS_PER_ITEM,
} from '@/lib/lost-found/media';
import {
  CLOSED_STATUSES,
  categoryLabel,
  DONATION_PARTNER,
  daysUntilDonation,
} from '@/lib/lost-found/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { ConfirmDialog } from './ConfirmDialog';
import {
  buttonClass,
  cardClass,
  formatDateTime,
  formatDayAndTime,
  primaryButtonClass,
  readError,
  SectionTitle,
} from './incidentUi';
import { LostFoundSessionPicker } from './LostFoundSessionPicker';
import { LostFoundStatusBadge } from './LostFoundStatusBadge';

interface DetailResponse {
  item: LostFoundItemRow;
  attachments: LostFoundAttachmentRow[];
  notices: LostFoundNoticeRow[];
  events: LostFoundEventRow[];
  people: PeopleNames;
  canManage: boolean;
  self: string;
}

interface PendingAction {
  status: string;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
}

/** Same masking as the sessions route, so the two lists can be compared. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Logged',
  updated: 'Edited',
  status_changed: 'Status changed',
  attachment_added: 'Photo added',
  attachment_removed: 'Photo removed',
  notified: 'Asked guests',
  claim_received: 'Claimed',
  picked_up: 'Picked up',
  donated: 'Donated',
  discarded: 'Discarded',
  donation_due: 'Flagged for donation',
};

export function LostFoundDetail({ itemId }: { itemId: string }) {
  const url = itemId ? `/api/admin/lost-found?id=${itemId}` : null;
  const { data, error, loading, reload } = useCachedJson<DetailResponse>(url);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const item = data?.item ?? null;
  const closed = item ? (CLOSED_STATUSES as readonly string[]).includes(item.status) : false;

  const askedMasked = useMemo(
    () => new Set((data?.notices ?? []).map((n) => maskEmail(n.email))),
    [data?.notices]
  );

  const refresh = async () => {
    invalidateJson('/api/admin/lost-found');
    await reload();
  };

  const setStatus = async (status: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/lost-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: itemId, status }),
      });
      if (!res.ok) {
        setActionError(await readError(res));
        return;
      }
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const askOwner = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/lost-found-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, mode: 'owner' }),
      });
      if (!res.ok) {
        setActionError(await readError(res));
        return;
      }
      const result = (await res.json()) as { sent: number; alreadyAsked: number };
      setNotice(result.sent > 0 ? 'Asked them.' : 'They have already been asked about this one.');
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      for (const file of [...files]) {
        const rejection = checkFile(file);
        if (rejection) {
          setActionError(rejection);
          continue;
        }
        const body = new FormData();
        body.set('itemId', itemId);
        body.set('file', await downscaleImage(file));
        const res = await fetch('/api/admin/lost-found-media', { method: 'POST', body });
        if (!res.ok) setActionError(await readError(res));
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error || !item) {
    return <p className="text-sm text-[var(--pyre-red)]">Couldn't load that item.</p>;
  }

  const days = daysUntilDonation(item.donate_after);
  const photos = (data?.attachments ?? []).filter((a) => a.kind === 'photo');

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-24">
      <a href="/admin/lost-found" className="font-mono text-xs text-white/45 hover:text-white/70">
        ← All items
      </a>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-primary-semibold text-[var(--pyre-creme)]">{item.title}</h1>
          <LostFoundStatusBadge status={item.status} />
        </div>
        <p className="font-mono text-xs text-white/45">
          {item.reference} · {categoryLabel(item.category)} · Found{' '}
          {formatDayAndTime(item.found_at)}
        </p>
      </header>

      {notice && <p className="text-sm text-[var(--pyre-sage)]">{notice}</p>}
      {actionError && <p className="text-sm text-[var(--pyre-red)]">{actionError}</p>}

      {!closed && (
        <section className="flex flex-wrap gap-2 border-b border-white/10 pb-6">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy}
            onClick={() =>
              setPending({
                status: 'picked_up',
                title: 'Hand it back?',
                body: `Marks ${item.reference} as collected. Check the distinguishing details against what they describe first.`,
                confirmLabel: 'Picked up',
              })
            }
          >
            Picked up
          </button>

          {data?.canManage && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                setPending({
                  status: 'donated',
                  title: `Donated to ${DONATION_PARTNER}?`,
                  body: `Records that ${item.reference} went to ${DONATION_PARTNER}. Only mark this once it has actually been dropped off.`,
                  confirmLabel: 'Donated',
                  danger: true,
                })
              }
            >
              Donated to {DONATION_PARTNER}
            </button>
          )}

          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              setPending({
                status: 'discarded',
                title: 'Bin it?',
                body: `Records that ${item.reference} was thrown away. For things nobody would want back.`,
                confirmLabel: 'Discard',
                danger: true,
              })
            }
          >
            Discard
          </button>
        </section>
      )}

      {item.claimed_by_email && !closed && (
        <div className={`${cardClass} border-[var(--pyre-gold)]/50`}>
          <SectionTitle note="Check the description against what they tell you before handing it over.">
            {item.claimed_by_name || item.claimed_by_email} says this is theirs
          </SectionTitle>
          <p className="font-mono text-xs text-white/45">
            {item.claimed_by_email} · claimed {formatDateTime(item.claimed_at)}
          </p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <a
              key={photo.id}
              href={`/api/admin/lost-found-media?id=${photo.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`/api/admin/lost-found-media?id=${photo.id}`}
                alt={photo.file_name}
                className="h-32 w-32 rounded border border-white/10 object-cover"
              />
            </a>
          ))}
          {!closed && photos.length < MAX_ATTACHMENTS_PER_ITEM && (
            <label className="flex h-32 w-32 cursor-pointer items-center justify-center rounded border border-dashed border-white/20 text-center font-mono text-[10px] uppercase tracking-wide text-white/50 hover:border-white/40">
              Add photo
              <input
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  void addPhoto(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      )}

      <section className={cardClass}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {item.description && (
            <div className="sm:col-span-2">
              <dt className="font-mono text-xs uppercase tracking-wide text-white/40">
                Distinguishing details
              </dt>
              <dd className="text-white/80">{item.description}</dd>
            </div>
          )}
          <div>
            <dt className="font-mono text-xs uppercase tracking-wide text-white/40">Kept</dt>
            <dd className="text-white/80">{item.storage_location || '—'}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs uppercase tracking-wide text-white/40">Logged by</dt>
            <dd className="text-white/80">
              {item.logged_by_name || personName(item.logged_by, data?.people)}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-mono text-xs uppercase tracking-wide text-white/40">
              Could have been left
            </dt>
            <dd className="text-white/80">
              {formatDayAndTime(item.left_window_start)} – {formatDayAndTime(item.left_window_end)}
            </dd>
          </div>
          {!closed && (
            <div className="sm:col-span-2">
              <dt className="font-mono text-xs uppercase tracking-wide text-white/40">
                {DONATION_PARTNER}
              </dt>
              <dd className={days <= 7 ? 'text-[var(--pyre-red)]' : 'text-white/80'}>
                {days <= 0
                  ? 'Ready to go on the next run'
                  : `${days} ${days === 1 ? 'day' : 'days'} left — ${formatDateTime(item.donate_after)}`}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {!closed && data?.canManage && (
        <section>
          <SectionTitle note="Everyone is asked once per item, and the email says when it goes to Furbish.">
            Ask whether it's theirs
          </SectionTitle>

          {item.owner_email ? (
            <div className={`${cardClass} mb-4`}>
              <p className="text-sm text-white/80">
                We think this belongs to{' '}
                <strong className="text-[var(--pyre-creme)]">
                  {item.owner_name || item.owner_email}
                </strong>
                .
              </p>
              <p className="mb-3 font-mono text-xs text-white/45">{item.owner_email}</p>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={busy}
                onClick={() => void askOwner()}
              >
                Ask them
              </button>
            </div>
          ) : null}

          <LostFoundSessionPicker
            itemId={itemId}
            windowStart={item.left_window_start}
            windowEnd={item.left_window_end}
            chosenSessionIds={item.chosen_session_ids ?? []}
            alreadyAsked={askedMasked}
            onSent={(summary) => {
              setNotice(summary);
              void refresh();
            }}
          />
        </section>
      )}

      {!closed && !data?.canManage && (
        <p className="text-xs text-white/40">
          Emailing guests about an item needs the lost-found:manage permission — ask an admin.
        </p>
      )}

      {(data?.notices ?? []).length > 0 && (
        <section>
          <SectionTitle>Who we asked</SectionTitle>
          <ul className="divide-y divide-white/5 rounded border border-white/10">
            {(data?.notices ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/80">
                    {row.name || row.email}
                  </span>
                  <span className="block truncate font-mono text-xs text-white/35">
                    {row.session_name ?? 'Named on the item'} · {formatDateTime(row.sent_at)}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide">
                  {row.response === 'claimed' ? (
                    <span className="text-[var(--pyre-gold)]">Claimed</span>
                  ) : row.response === 'not_mine' ? (
                    <span className="text-white/30">Not theirs</span>
                  ) : (
                    <span className="text-white/25">No answer</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data?.events ?? []).length > 0 && (
        <section>
          <SectionTitle>History</SectionTitle>
          <ol className="space-y-1.5">
            {(data?.events ?? []).map((event) => (
              <li key={event.id} className="font-mono text-xs text-white/40">
                <span className="text-white/60">{EVENT_LABELS[event.action] ?? event.action}</span>{' '}
                · {formatDateTime(event.created_at)} ·{' '}
                {event.actor === 'cron'
                  ? 'automatically'
                  : event.actor === 'guest'
                    ? 'by the guest'
                    : personName(event.actor, data?.people)}
                {event.note && <span className="block pl-2 text-white/35">{event.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          danger={pending.danger}
          busy={busy}
          onConfirm={() => void setStatus(pending.status)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

export default LostFoundDetail;
