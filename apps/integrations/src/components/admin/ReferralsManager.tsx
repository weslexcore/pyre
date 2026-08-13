// Referral program management: the referrer registry (member + partner codes),
// the redemption queue, the reward ledger, and the discount tier map. One API
// route; the manage capability gates every mutation, so a read-only grant
// still gets the full picture.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReferralRedemptionRow,
  ReferralRewardRow,
  ReferralTierRow,
  ReferrerRow,
} from '@/lib/db';

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const pillClass = (active: boolean) =>
  `px-2.5 py-1.5 rounded text-xs font-mono uppercase tracking-wide border transition-colors ${
    active
      ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
      : 'border-white/10 bg-white/5 text-white/50 hover:border-white/30 hover:text-white'
  }`;

const sectionHeading = 'font-mono text-xs font-bold uppercase tracking-wide text-white/40';
const card = 'rounded-lg border border-white/10 bg-white/[0.03] p-3';

interface ReferralsPayload {
  referrers: ReferrerRow[];
  redemptions: ReferralRedemptionRow[];
  rewards: ReferralRewardRow[];
  tiers: ReferralTierRow[];
  rewardTagName: string;
  tagStatus: Record<string, boolean | null>;
  counts: Record<string, number>;
  canManage: boolean;
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-300/80',
  redeemed: 'text-blue-300/80',
  converted: 'text-green-300/80',
  granted: 'text-blue-300/80',
  consumed: 'text-green-300/80',
  expired: 'text-white/40',
  revoked: 'text-[var(--pyre-red)]',
};

const REDEMPTION_FILTERS = ['all', 'pending', 'redeemed', 'converted', 'expired', 'revoked'];

export function ReferralsManager() {
  const [data, setData] = useState<ReferralsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // Search is applied on submit (and carried along when the filter changes),
  // not per keystroke — the ref keeps the effect below off the input's back.
  const searchRef = useRef('');
  searchRef.current = search;

  const load = useCallback(async (q: string, status: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    try {
      const res = await fetch(`/api/admin/referrals?${params}`);
      if (!res.ok) {
        setLoadError(await readError(res));
        return;
      }
      setData((await res.json()) as ReferralsPayload);
      setLoadError(null);
    } catch {
      setLoadError('Failed to load');
    }
  }, []);

  useEffect(() => {
    load(searchRef.current, statusFilter);
  }, [load, statusFilter]);

  const act = useCallback(
    async (body: Record<string, unknown>, successNotice?: string) => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      try {
        const res = await fetch('/api/admin/referrals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          setActionError(await readError(res));
          return false;
        }
        if (successNotice) setNotice(successNotice);
        await load(search, statusFilter);
        return true;
      } catch {
        setActionError('Request failed');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, search, statusFilter]
  );

  if (loadError) {
    return <p className="font-mono text-sm text-[var(--pyre-red)]">{loadError}</p>;
  }
  if (!data) {
    return <p className="font-mono text-sm text-white/40">Loading…</p>;
  }

  const referrersById = new Map(data.referrers.map((r) => [r.id, r]));
  const canManage = data.canManage;

  return (
    <div className="space-y-8">
      {actionError && (
        <p className="font-mono text-sm text-[var(--pyre-red)]" role="alert">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="font-mono text-sm text-green-300/80" role="status">
          {notice}
        </p>
      )}

      <TiersSection
        tiers={data.tiers}
        rewardTagName={data.rewardTagName}
        tagStatus={data.tagStatus}
        canManage={canManage}
        busy={busy}
        act={act}
      />

      <ReferrersSection
        referrers={data.referrers}
        tiers={data.tiers}
        canManage={canManage}
        busy={busy}
        act={act}
        search={search}
        setSearch={setSearch}
        onSearch={() => load(search, statusFilter)}
      />

      <RedemptionsSection
        redemptions={data.redemptions}
        counts={data.counts}
        referrersById={referrersById}
        canManage={canManage}
        busy={busy}
        act={act}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
      />

      <RewardsSection
        rewards={data.rewards}
        referrersById={referrersById}
        canManage={canManage}
        busy={busy}
        act={act}
      />
    </div>
  );
}

type Act = (body: Record<string, unknown>, successNotice?: string) => Promise<boolean>;

function TiersSection({
  tiers,
  rewardTagName,
  tagStatus,
  canManage,
  busy,
  act,
}: {
  tiers: ReferralTierRow[];
  rewardTagName: string;
  tagStatus: Record<string, boolean | null>;
  canManage: boolean;
  busy: boolean;
  act: Act;
}) {
  const [percent, setPercent] = useState('');
  const [tagName, setTagName] = useState('');
  const [label, setLabel] = useState('');

  const tagBadge = (name: string) => {
    const status = tagStatus[name];
    if (status === true) return <span className="text-green-300/80">tag ok</span>;
    if (status === false)
      return <span className="text-[var(--pyre-red)]">tag missing in Momence</span>;
    return <span className="text-white/40">tag unchecked</span>;
  };

  return (
    <section className="space-y-3">
      <h2 className={sectionHeading}>Discount tiers</h2>
      <p className="text-xs text-white/40 max-w-2xl">
        Each tier needs its Momence customer tag AND a price rule keyed on that tag, both created by
        hand in the Momence dashboard before the tier works. The reward tag ({rewardTagName}) needs
        its own price rule the same way. After creating a tag in Momence, refresh the tag cache.
      </p>
      <div className="flex flex-wrap gap-2">
        {tiers.map((tier) => (
          <div key={tier.percent} className={`${card} flex items-center gap-3`}>
            <span className="font-mono text-sm text-[var(--pyre-creme)]">{tier.label}</span>
            <span className="font-mono text-xs text-white/50">{tier.tag_name}</span>
            <span className="font-mono text-xs">{tagBadge(tier.tag_name)}</span>
            {!tier.enabled && <span className="font-mono text-xs text-white/40">disabled</span>}
            {canManage && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  act({ action: 'toggle-tier', percent: tier.percent, enabled: !tier.enabled })
                }
              >
                {tier.enabled ? 'Disable' : 'Enable'}
              </button>
            )}
          </div>
        ))}
        <div className={`${card} flex items-center gap-3`}>
          <span className="font-mono text-xs text-white/50">Reward</span>
          <span className="font-mono text-xs text-white/50">{rewardTagName}</span>
          <span className="font-mono text-xs">{tagBadge(rewardTagName)}</span>
        </div>
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} w-24`}
            placeholder="%"
            inputMode="numeric"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
          <input
            className={`${inputClass} w-48`}
            placeholder="Momence tag (referral)"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
          />
          <input
            className={`${inputClass} w-28`}
            placeholder='Label ("$5")'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !percent || !tagName}
            onClick={async () => {
              const ok = await act(
                {
                  action: 'create-tier',
                  percent: Number(percent),
                  tagName: tagName.trim(),
                  label: label.trim(),
                },
                'Tier created — now create the tag + price rule in Momence'
              );
              if (ok) {
                setPercent('');
                setTagName('');
                setLabel('');
              }
            }}
          >
            Add tier
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => act({ action: 'refresh-tag-cache' }, 'Momence tag cache refreshed')}
          >
            Refresh Momence tags
          </button>
        </div>
      )}
    </section>
  );
}

function ReferrersSection({
  referrers,
  tiers,
  canManage,
  busy,
  act,
  search,
  setSearch,
  onSearch,
}: {
  referrers: ReferrerRow[];
  tiers: ReferralTierRow[];
  canManage: boolean;
  busy: boolean;
  act: Act;
  search: string;
  setSearch: (v: string) => void;
  onSearch: () => void;
}) {
  const [memberEmail, setMemberEmail] = useState('');
  const [partnerSlug, setPartnerSlug] = useState('');
  const [partnerCode, setPartnerCode] = useState('');

  return (
    <section className="space-y-3">
      <h2 className={sectionHeading}>Referrers</h2>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} w-64`}
            placeholder="Member email — mint their code"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !memberEmail.trim()}
            onClick={async () => {
              const ok = await act(
                { action: 'create-member-referrer', email: memberEmail.trim() },
                'Member referrer ready'
              );
              if (ok) setMemberEmail('');
            }}
          >
            Add member
          </button>
          <span className="text-white/20">|</span>
          <input
            className={`${inputClass} w-32`}
            placeholder="partner slug"
            value={partnerSlug}
            onChange={(e) => setPartnerSlug(e.target.value)}
          />
          <input
            className={`${inputClass} w-32`}
            placeholder="CODE"
            value={partnerCode}
            onChange={(e) => setPartnerCode(e.target.value.toUpperCase())}
          />
          <button
            type="button"
            className={buttonClass}
            disabled={busy || !partnerSlug.trim() || !partnerCode.trim()}
            onClick={async () => {
              const ok = await act(
                {
                  action: 'create-partner-referrer',
                  partnerSlug: partnerSlug.trim(),
                  code: partnerCode.trim(),
                },
                'Partner referrer created'
              );
              if (ok) {
                setPartnerSlug('');
                setPartnerCode('');
              }
            }}
          >
            Add partner
          </button>
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <input
          className={`${inputClass} w-64`}
          placeholder="Search code, name, email, slug"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className={buttonClass} disabled={busy}>
          Search
        </button>
      </form>

      <div className="space-y-2">
        {referrers.length === 0 && (
          <p className="font-mono text-xs text-white/30">No referrers yet.</p>
        )}
        {referrers.map((referrer) => (
          <div key={referrer.id} className={`${card} flex flex-wrap items-center gap-3`}>
            <span className="font-mono text-sm font-bold text-[var(--pyre-creme)]">
              {referrer.code}
            </span>
            <span className="text-sm text-white/70">{referrer.display_name}</span>
            <span className="font-mono text-xs text-white/40">
              {referrer.referrer_type === 'partner'
                ? `partner:${referrer.partner_slug}`
                : (referrer.email ?? `member:${referrer.momence_member_id}`)}
            </span>
            {canManage ? (
              <select
                className={`${inputClass} py-1`}
                value={referrer.discount_percent}
                disabled={busy}
                onChange={(e) =>
                  act({
                    action: 'update-referrer',
                    id: referrer.id,
                    discountPercent: Number(e.target.value),
                  })
                }
              >
                {tiers.map((tier) => (
                  <option key={tier.percent} value={tier.percent}>
                    {tier.percent}%
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-xs text-white/50">{referrer.discount_percent}%</span>
            )}
            {!referrer.enabled && (
              <span className="font-mono text-xs text-[var(--pyre-red)]">disabled</span>
            )}
            <span className="ml-auto font-mono text-xs text-white/30">
              {fmtDate(referrer.created_at)}
            </span>
            {canManage && (
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  act({ action: 'update-referrer', id: referrer.id, enabled: !referrer.enabled })
                }
              >
                {referrer.enabled ? 'Disable' : 'Enable'}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RedemptionsSection({
  redemptions,
  counts,
  referrersById,
  canManage,
  busy,
  act,
  statusFilter,
  setStatusFilter,
}: {
  redemptions: ReferralRedemptionRow[];
  counts: Record<string, number>;
  referrersById: Map<string, ReferrerRow>;
  canManage: boolean;
  busy: boolean;
  act: Act;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className={sectionHeading}>Redemptions</h2>
      <div className="flex flex-wrap gap-2">
        {REDEMPTION_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            className={pillClass(statusFilter === status)}
            onClick={() => setStatusFilter(status)}
          >
            {status}
            {status !== 'all' && counts[status] != null && ` (${counts[status]})`}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {redemptions.length === 0 && (
          <p className="font-mono text-xs text-white/30">Nothing here.</p>
        )}
        {redemptions.map((row) => {
          const referrer = referrersById.get(row.referrer_id);
          return (
            <div key={row.id} className={`${card} flex flex-wrap items-center gap-3`}>
              <span className={`font-mono text-xs uppercase ${STATUS_COLORS[row.status] ?? ''}`}>
                {row.status}
              </span>
              <span className="text-sm text-white/80">
                {row.friend_first_name} {row.friend_last_name}
              </span>
              <span className="font-mono text-xs text-white/40">{row.friend_email}</span>
              <span className="font-mono text-xs text-white/50">
                via {row.code}
                {referrer ? ` (${referrer.display_name})` : ''} · {row.discount_percent}%
              </span>
              {row.cancelled_at && (
                <span className="font-mono text-xs text-[var(--pyre-red)]">
                  converting booking cancelled {fmtDate(row.cancelled_at)}
                </span>
              )}
              {row.status === 'revoked' && row.revoke_reason && (
                <span className="font-mono text-xs text-white/40">({row.revoke_reason})</span>
              )}
              <span className="ml-auto font-mono text-xs text-white/30">
                {fmtDate(row.created_at)}
                {row.converted_at && ` → booked ${fmtDate(row.converted_at)}`}
              </span>
              {canManage && (row.status === 'redeemed' || row.status === 'pending') && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Revoke ${row.friend_email}'s discount?`)) {
                      act({ action: 'revoke-redemption', id: row.id }, 'Redemption revoked');
                    }
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RewardsSection({
  rewards,
  referrersById,
  canManage,
  busy,
  act,
}: {
  rewards: ReferralRewardRow[];
  referrersById: Map<string, ReferrerRow>;
  canManage: boolean;
  busy: boolean;
  act: Act;
}) {
  return (
    <section className="space-y-3">
      <h2 className={sectionHeading}>Rewards</h2>
      <div className="space-y-2">
        {rewards.length === 0 && (
          <p className="font-mono text-xs text-white/30">No rewards granted yet.</p>
        )}
        {rewards.map((row) => {
          const referrer = referrersById.get(row.referrer_id);
          return (
            <div key={row.id} className={`${card} flex flex-wrap items-center gap-3`}>
              <span className={`font-mono text-xs uppercase ${STATUS_COLORS[row.status] ?? ''}`}>
                {row.status}
              </span>
              <span className="text-sm text-white/80">
                {referrer?.display_name ?? row.referrer_id}
              </span>
              {referrer && <span className="font-mono text-xs text-white/40">{referrer.code}</span>}
              <span className="ml-auto font-mono text-xs text-white/30">
                granted {fmtDate(row.granted_at)}
                {row.consumed_at && ` → used ${fmtDate(row.consumed_at)}`}
              </span>
              {canManage && row.status === 'granted' && (
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Revoke this reward?')) {
                      act({ action: 'revoke-reward', id: row.id }, 'Reward revoked');
                    }
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
