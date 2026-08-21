// The incident log (/admin/incidents). Two audiences in one page:
//
//   * Someone who came here to report something — the button at the top is
//     the biggest thing on the screen, because at that moment nothing else on
//     this page matters.
//   * A reviewer working the queue — open reports first, then filters and the
//     full history, with the counts that say whether the building is getting
//     safer or not.
//
// Reporters without incidents:manage only ever see the reports they filed;
// the API enforces that, this island just labels it.
//
// Reads go through useCachedJson, so coming back to the log from a report
// paints the last-known list immediately and revalidates behind it. The
// report page invalidates this prefix after any change, so a status flip
// there can't leave a stale row here.

import { useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { IncidentRow } from '@/lib/db';
import {
  areaLabel,
  CATEGORY_OPTIONS,
  categoryLabel,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  OPEN_STATUSES,
  severityLabel,
  statusLabel,
} from '@/lib/incidents/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import {
  buttonClass,
  cardClass,
  formatDayAndTime,
  inputClass,
  primaryButtonClass,
  SeverityBadge,
  StatusBadge,
} from './incidentUi';

interface ListResponse {
  incidents: IncidentRow[];
  attachmentCounts: Record<string, number>;
  people: PeopleNames;
  scope: 'all' | 'mine';
  canManage: boolean;
  self: string;
}

const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All', days: null },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

export function IncidentsIndex() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [range, setRange] = useState<RangeKey>('90d');
  const [search, setSearch] = useState('');

  // The URL is the cache key, so each filter combination caches separately.
  // `since` is quantised to the day: a timestamp of "now" would miss the
  // cache on every render and defeat the point.
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (severityFilter) params.set('severity', severityFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    if (days != null) {
      const since = new Date(Date.now() - days * 86_400_000);
      since.setHours(0, 0, 0, 0);
      params.set('since', since.toISOString());
    }
    const query = params.toString();
    return query ? `/api/admin/incidents?${query}` : '/api/admin/incidents';
  }, [statusFilter, severityFilter, categoryFilter, range]);

  const { data, error, loading } = useCachedJson<ListResponse>(url);

  const incidents = data?.incidents ?? [];
  const people = data?.people ?? {};

  // Free-text search stays client-side: the log is small, and searching what
  // is already on screen is instant and works offline of another round trip.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return incidents;
    return incidents.filter((i) =>
      [
        i.reference,
        i.description,
        i.immediate_actions,
        i.area_detail ?? '',
        i.reported_by_name ?? '',
        i.reported_by,
        personName(i.reported_by, people),
        categoryLabel(i.category),
        areaLabel(i.area),
        JSON.stringify(i.affected_people),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [incidents, search, people]);

  const openCount = incidents.filter((i) =>
    (OPEN_STATUSES as readonly string[]).includes(i.status)
  ).length;
  const seriousCount = incidents.filter(
    (i) => i.severity === 'severe' || i.severity === 'critical'
  ).length;
  const injuredCount = incidents.reduce(
    (sum, i) =>
      sum + (i.affected_people as { injured?: boolean }[]).filter((p) => p?.injured).length,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 p-4">
        <div>
          <p className="text-sm font-primary-semibold text-[var(--pyre-creme)]">
            Something happen in the building?
          </p>
          <p className="mt-0.5 text-xs text-white/60">
            File it while it's fresh — takes about two minutes on your phone.
          </p>
        </div>
        <a href="/admin/incidents/new" className={primaryButtonClass}>
          Report an incident
        </a>
      </div>

      {data && !data.canManage && (
        <p className="font-mono text-xs text-white/40">
          Showing the reports you filed. Reviewers see the whole log.
        </p>
      )}

      {data?.canManage && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Open" value={openCount} accent={openCount > 0} />
          <Stat label="Severe+" value={seriousCount} accent={seriousCount > 0} />
          <Stat label="People injured" value={injuredCount} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${inputClass} w-auto py-2 text-sm`}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Any status</option>
          <option value="open">Open only</option>
          {INCIDENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>

        <select
          className={`${inputClass} w-auto py-2 text-sm`}
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">Any severity</option>
          {INCIDENT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {severityLabel(s)}
            </option>
          ))}
        </select>

        <select
          className={`${inputClass} w-auto py-2 text-sm`}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">Any type</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <span className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`${buttonClass} ${range === r.key ? 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </span>

        <input
          className={`${inputClass} w-auto min-w-[180px] flex-1 py-2 text-sm`}
          placeholder="Search reports…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 px-3 py-2 text-sm text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {!loading && visible.length === 0 && !error && (
        <p className={`${cardClass} text-sm text-white/50`}>
          {incidents.length === 0
            ? 'No incidents in this range. That is the good outcome.'
            : 'Nothing matches that search.'}
        </p>
      )}

      <ul className="space-y-2">
        {visible.map((incident) => {
          const attachments = data?.attachmentCounts?.[incident.id] ?? 0;
          const injured = (incident.affected_people as { injured?: boolean }[]).filter(
            (p) => p?.injured
          ).length;
          return (
            <li key={incident.id}>
              <a
                href={`/admin/incidents/${incident.id}`}
                className="block rounded border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/25"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-white/40">{incident.reference}</span>
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  {attachments > 0 && (
                    <span className="font-mono text-[10px] text-white/40">📎 {attachments}</span>
                  )}
                  {incident.follow_up_required && (
                    <span className="font-mono text-[10px] uppercase text-[var(--pyre-gold)]">
                      follow-up
                    </span>
                  )}
                </div>

                <p className="mt-1.5 text-sm font-primary-semibold text-[var(--pyre-creme)]">
                  {categoryLabel(incident.category)} — {areaLabel(incident.area)}
                  {incident.area_detail ? ` (${incident.area_detail})` : ''}
                </p>

                <p className="mt-1 line-clamp-2 text-sm leading-snug text-white/60">
                  {incident.description}
                </p>

                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-white/35">
                  {formatDayAndTime(incident.occurred_at)}
                  {' · '}
                  filed by {personName(incident.reported_by, people)}
                  {injured > 0 && ` · ${injured} injured`}
                  {incident.ems_called && ' · EMS'}
                </p>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cardClass}>
      <p
        className={`text-2xl font-primary-semibold ${accent ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-creme)]'}`}
      >
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
