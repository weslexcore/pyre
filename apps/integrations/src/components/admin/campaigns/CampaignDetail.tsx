// One campaign (/admin/campaigns/[id]): the header, the placement tiles that
// generate links, the links themselves, and how the campaign is doing.

import { useCallback, useMemo, useState } from 'react';
import { campaignErrorMessage } from '@/lib/campaigns/errors';
import type {
  BlogPostRef,
  CampaignDetailResponse,
  LinkRow as LinkRowData,
  UtmCampaign,
} from '@/lib/campaigns/types';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { loadQrStyle, type QrStyle, saveQrStyle } from '@/lib/qr/style';
import { ConfirmDialog } from '../ConfirmDialog';
import { CopyButton } from '../CopyButton';
import { buttonClass, cardClass, readError, SectionTitle } from '../incidentUi';
import { QrStyleControls } from '../qr/QrStyleControls';
import { CampaignForm } from './CampaignForm';
import { CampaignStats } from './CampaignStats';
import {
  ArchivedBadge,
  dateRangeLabel,
  isSessionExpired,
  SessionExpired,
  TypeBadge,
} from './campaignUi';
import { useEvents } from './DestinationPicker';
import { LinkRow } from './LinkRow';
import { type GenerateRequest, PlacementGrid } from './PlacementGrid';

export function CampaignDetail({
  campaignId,
  origin,
  blogPosts,
}: {
  campaignId: string;
  origin: string;
  blogPosts: BlogPostRef[];
}) {
  const url = `/api/admin/campaigns/${encodeURIComponent(campaignId)}`;
  const { data, error, loading, setData } = useCachedJson<CampaignDetailResponse>(url);
  const events = useEvents();

  const [editing, setEditing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyLink, setBusyLink] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [showQrStyle, setShowQrStyle] = useState(false);
  const [qrStyle, setQrStyle] = useState<QrStyle>(() => loadQrStyle());

  const updateQrStyle = useCallback((next: QrStyle) => {
    setQrStyle(next);
    saveQrStyle(next);
  }, []);

  const campaign = data?.campaign ?? null;
  const links = useMemo(() => data?.links ?? [], [data?.links]);

  const patchCampaign = useCallback(
    async (body: Record<string, unknown>): Promise<UtmCampaign | null> => {
      setActionError(null);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setActionError(campaignErrorMessage(await readError(res)));
        return null;
      }
      const json = (await res.json()) as { campaign: UtmCampaign };
      setData((prev) => (prev ? { ...prev, campaign: json.campaign } : prev));
      invalidateJson('/api/admin/campaigns?');
      return json.campaign;
    },
    [url, setData]
  );

  const generate = useCallback(
    async (req: GenerateRequest): Promise<boolean> => {
      setBusyKey(req.placementKey);
      setGenerateError(null);
      try {
        const res = await fetch(`${url}/links`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        const json = (await res.json().catch(() => ({}))) as { link?: LinkRowData; error?: string };
        if (!res.ok || !json.link) {
          setGenerateError(campaignErrorMessage(json.error, `Could not generate (${res.status})`));
          return false;
        }
        const link = json.link;
        setData((prev) => (prev ? { ...prev, links: [...prev.links, link] } : prev));
        invalidateJson('/api/admin/campaigns?');
        return true;
      } catch {
        setGenerateError('Network error');
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [url, setData]
  );

  const patchLink = useCallback(
    async (linkId: string, body: Record<string, unknown>) => {
      setBusyLink(linkId);
      setActionError(null);
      try {
        const res = await fetch(`${url}/links/${encodeURIComponent(linkId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setActionError(campaignErrorMessage(await readError(res)));
          return;
        }
        const json = (await res.json()) as { link: LinkRowData };
        setData((prev) =>
          prev
            ? {
                ...prev,
                links: prev.links.map((l) =>
                  l.id === linkId ? { ...json.link, clicks: l.clicks || json.link.clicks } : l
                ),
              }
            : prev
        );
      } finally {
        setBusyLink(null);
      }
    },
    [url, setData]
  );

  const deleteLink = useCallback(
    async (linkId: string) => {
      setBusyLink(linkId);
      setActionError(null);
      try {
        const res = await fetch(`${url}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
        if (!res.ok) {
          setActionError(campaignErrorMessage(await readError(res)));
          return;
        }
        setData((prev) =>
          prev ? { ...prev, links: prev.links.filter((l) => l.id !== linkId) } : prev
        );
        invalidateJson('/api/admin/campaigns?');
      } finally {
        setBusyLink(null);
      }
    },
    [url, setData]
  );

  const deleteCampaign = useCallback(async () => {
    setDeleting(true);
    setActionError(null);
    try {
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        setActionError(campaignErrorMessage(await readError(res)));
        return;
      }
      invalidateJson('/api/admin/campaigns');
      window.location.assign('/admin/campaigns');
    } finally {
      setDeleting(false);
    }
  }, [url]);

  if (isSessionExpired(error) || events.sessionExpired) {
    return <SessionExpired returnTo={`/admin/campaigns/${campaignId}`} />;
  }
  if (error) {
    return (
      <p className="text-sm text-[var(--pyre-red)]">
        {error.includes('404') ? 'That campaign no longer exists.' : `Could not load: ${error}`}{' '}
        <a href="/admin/campaigns" className="underline">
          Back to campaigns
        </a>
      </p>
    );
  }
  if (loading || !campaign) return <p className="font-mono text-xs text-white/40">Loading…</p>;

  const range = dateRangeLabel(campaign);
  const archived = campaign.status === 'archived';

  return (
    <div className="space-y-6">
      <a
        href="/admin/campaigns"
        className="inline-block font-mono text-xs text-white/40 hover:text-white"
      >
        All campaigns
      </a>

      <header className={cardClass}>
        {editing ? (
          <CampaignForm
            origin={origin}
            blogPosts={blogPosts}
            initial={campaign}
            linkCount={links.length}
            onSaved={(next) => {
              setData((prev) => (prev ? { ...prev, campaign: next } : prev));
              invalidateJson('/api/admin/campaigns?');
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-primary-semibold text-xl text-[var(--pyre-creme)]">
                    {campaign.name}
                  </h2>
                  <TypeBadge type={campaign.type} />
                  {archived && <ArchivedBadge />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-white/50">
                  <span>utm_campaign={campaign.slug}</span>
                  <CopyButton
                    value={campaign.slug}
                    label="Copy"
                    className="!px-2 !py-1 !text-[10px]"
                  />
                </div>
                {range && <p className="mt-1 text-xs text-white/50">{range}</p>}
                {campaign.destinationUrl ? (
                  <p className="mt-1 font-mono text-xs text-white/40 break-all">
                    Links open {campaign.destinationUrl}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-[var(--pyre-gold)]">
                    This campaign has no destination yet. Edit it and choose where links should go
                    before generating any.
                  </p>
                )}
                {campaign.notes && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-white/70">{campaign.notes}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing(true)} className={buttonClass}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void patchCampaign({ status: archived ? 'active' : 'archived' })}
                  className={buttonClass}
                >
                  {archived ? 'Unarchive' : 'Archive'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={`${buttonClass} text-[var(--pyre-red)]/80 hover:text-[var(--pyre-red)]`}
                >
                  Delete
                </button>
              </div>
            </div>
            {actionError && <p className="text-sm text-[var(--pyre-red)]">{actionError}</p>}
          </div>
        )}
      </header>

      <section className={cardClass}>
        <SectionTitle note="One click per placement. The link gets its utm values from the placement and this campaign's name, so nothing needs typing.">
          Generate a link
        </SectionTitle>
        <PlacementGrid
          links={links}
          slug={campaign.slug}
          destinationSet={Boolean(campaign.destinationUrl)}
          origin={origin}
          blogPosts={blogPosts}
          events={events}
          busyKey={busyKey}
          error={generateError}
          onGenerate={generate}
        />
      </section>

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle
            note={links.length ? 'Copy the highlighted link for each placement.' : undefined}
          >
            Links
          </SectionTitle>
          {links.length > 0 && (
            <button type="button" onClick={() => setShowQrStyle((v) => !v)} className={buttonClass}>
              {showQrStyle ? 'Hide QR style' : 'QR style'}
            </button>
          )}
        </div>
        {showQrStyle && <QrStyleControls style={qrStyle} onChange={updateQrStyle} />}
        {links.length === 0 ? (
          <p className="text-sm text-white/50">No links yet. Pick a placement above.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {links.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                campaign={campaign}
                qrStyle={qrStyle}
                busy={busyLink === link.id}
                onRelabel={(label) => patchLink(link.id, { label })}
                onMintShort={() => patchLink(link.id, { mintShort: true })}
                onDelete={() => deleteLink(link.id)}
              />
            ))}
          </ul>
        )}

        {data && data.otherShortlinks.length > 0 && (
          <div className="mt-4 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setShowOrphans((v) => !v)}
              className="font-mono text-xs text-white/50 hover:text-white"
            >
              {showOrphans ? 'Hide' : 'Show'} {data.otherShortlinks.length} other short link
              {data.otherShortlinks.length === 1 ? '' : 's'} made for this campaign before this tool
            </button>
            {showOrphans && (
              <ul className="mt-2 space-y-1">
                {data.otherShortlinks.map((s) => (
                  <li
                    key={s.code}
                    className="flex flex-wrap items-center gap-2 text-xs text-white/60"
                  >
                    <code className="font-mono text-[var(--pyre-creme)]">{s.shortUrl}</code>
                    {s.label && <span>{s.label}</span>}
                    <span className="text-white/40">
                      {s.clicks} click{s.clicks === 1 ? '' : 's'}
                    </span>
                    <CopyButton value={s.shortUrl} className="!px-2 !py-1 !text-[10px]" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <CampaignStats slug={campaign.slug} links={links} />

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this campaign?"
          body={
            links.length > 0
              ? `Its ${links.length} link${links.length === 1 ? '' : 's'} and their short links go with it. Anything already printed or posted will send people to the home page. Archiving keeps the links working.`
              : 'This cannot be undone.'
          }
          confirmLabel="Delete campaign"
          danger
          busy={deleting}
          onConfirm={() => void deleteCampaign()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
