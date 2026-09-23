import { type LinkPerformance, linkColor } from '@/lib/campaigns/link-performance';

export interface LinkSegment {
  id: string;
  label: string;
  value: number;
}

export function LinkBar({
  segments,
  total,
  target,
  pace,
  label,
}: {
  segments: LinkSegment[];
  total: number;
  target?: number;
  pace?: number | null;
  label: string;
}) {
  const denominator = Math.max(total, target ?? 0, 1);
  return (
    <div
      className="relative flex h-3 overflow-hidden rounded bg-white/5"
      role="img"
      aria-label={`${label}: ${
        segments
          .filter((segment) => segment.value > 0)
          .map((segment) => `${segment.label} ${segment.value}`)
          .join(', ') || 'No data'
      }`}
    >
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <span
            key={segment.id}
            className="block h-full"
            style={{
              backgroundColor: linkColor(segment.id),
              width: `${(segment.value / denominator) * 100}%`,
            }}
            title={`${segment.label}: ${segment.value} (${total ? Math.round((segment.value / total) * 100) : 0}%)`}
          />
        ))}
      {pace != null && pace > 0 && pace < denominator && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-white/70"
          style={{ left: `${(pace / denominator) * 100}%` }}
        />
      )}
    </div>
  );
}

export const DISPLAY_METRICS = [
  ['clicks', 'Clicks'],
  ['pageviews', 'Pageviews'],
  ['visitors', 'Visitors'],
  ['introOfferSignups', 'Intro signups'],
  ['mailingListSignups', 'Email signups'],
  ['bookings', 'Bookings'],
  ['introPurchases', 'Intro purchases'],
  ['creditPacks', 'Packs'],
  ['memberships', 'Memberships'],
] as const;

export function LinkBreakdown({
  links,
  conversionsAvailable,
}: {
  links: LinkPerformance[];
  conversionsAvailable: boolean;
}) {
  return (
    <section className="mt-4 space-y-2">
      <h3 className="text-sm">Results by link</h3>
      <p className="text-xs text-white/45">
        Each link keeps the same color across the bars. Unknown link means the tracking tags are
        missing or shared by multiple links. Visitors are assigned to their first campaign link in
        this period. Clicks are lifetime totals.
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Link colors">
        {links.map((link) => (
          <li key={link.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: linkColor(link.id) }}
            />
            <span>{link.label}</span>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <caption className="sr-only">
            Traffic and conversions attributed to each campaign link
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-2">
                Link
              </th>
              {DISPLAY_METRICS.map(([key, label]) => (
                <th scope="col" className="p-2" key={key}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <th scope="row" className="p-2 font-normal">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-2 w-2 rounded-sm"
                    style={{ backgroundColor: linkColor(link.id) }}
                  />
                  {link.label}
                </th>
                {DISPLAY_METRICS.map(([metric]) => (
                  <td key={metric} className="p-2 tabular-nums">
                    {metric === 'clicks' || conversionsAvailable ? link[metric] : '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
