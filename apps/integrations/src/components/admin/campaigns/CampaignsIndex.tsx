// The campaign hub (/admin/campaigns): every campaign, what it is, how long
// it runs, and how many clicks its links have taken. Reads go through
// useCachedJson so coming back from a campaign paints the last-known list
// immediately and revalidates behind it.

import { useMemo, useState } from 'react';
import type { CampaignListResponse } from '@/lib/campaigns/types';
import { useCachedJson } from '@/lib/client/cachedJson';
import { buttonClass, cardClass, inputClass, primaryButtonClass } from '../incidentUi';
import {
  ArchivedBadge,
  dateRangeLabel,
  isSessionExpired,
  SessionExpired,
  TypeBadge,
} from './campaignUi';

export function CampaignsIndex() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');

  const url = `/api/admin/campaigns?status=${showArchived ? 'all' : 'active'}`;
  const { data, error, loading, refreshing } = useCachedJson<CampaignListResponse>(url);

  const campaigns = useMemo(() => {
    const rows = data?.campaigns ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) =>
      [c.name, c.slug, c.notes, c.destinationUrl].some((f) => f.toLowerCase().includes(needle))
    );
  }, [data?.campaigns, search]);

  if (isSessionExpired(error)) return <SessionExpired returnTo="/admin/campaigns" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <a href="/admin/campaigns/new" className={primaryButtonClass}>
          New campaign
        </a>
        <a href="/admin/campaigns/performance" className={buttonClass}>
          Performance report
        </a>
        <label className="ml-auto flex items-center gap-2 font-mono text-xs text-white/50">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {refreshing && <span className="font-mono text-xs text-white/35">Refreshing…</span>}
      </div>

      <input
        className={inputClass}
        value={search}
        placeholder="Search campaigns"
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <p className="text-sm text-[var(--pyre-red)]">Could not load campaigns: {error}</p>}
      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {!loading && campaigns.length === 0 && (
        <div className={cardClass}>
          {search ? (
            <p className="text-sm text-white/60">Nothing matches that.</p>
          ) : (
            <div className="space-y-1 text-sm text-white/60">
              <p>No campaigns yet. Here is how it works:</p>
              <p>
                1. Create a campaign for the thing you are promoting: an event, a sale, a launch.
              </p>
              <p>2. Open it and click a placement, like Instagram bio or Email newsletter.</p>
              <p>
                3. Copy the link it gives you. Every link carries the same campaign name, so the
                report adds up.
              </p>
            </div>
          )}
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {campaigns.map((campaign) => {
          const range = dateRangeLabel(campaign);
          return (
            <li key={campaign.id}>
              <a
                href={`/admin/campaigns/${campaign.id}`}
                className={`${cardClass} block h-full transition-colors hover:border-white/30`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-primary-semibold text-base text-[var(--pyre-creme)] truncate">
                      {campaign.name}
                    </h3>
                    <p className="font-mono text-xs text-white/35 truncate">{campaign.slug}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <TypeBadge type={campaign.type} />
                    {campaign.status === 'archived' && <ArchivedBadge />}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-white/50">
                  <span>
                    {campaign.linkCount} link{campaign.linkCount === 1 ? '' : 's'}
                  </span>
                  <span>
                    {campaign.clicks} click{campaign.clicks === 1 ? '' : 's'}
                  </span>
                  {range && <span>{range}</span>}
                </div>
                {!campaign.destinationUrl && (
                  <p className="mt-2 text-xs text-[var(--pyre-gold)]">Destination not set</p>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
