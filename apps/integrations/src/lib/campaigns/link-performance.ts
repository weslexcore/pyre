import { type ConversionCounts, EMPTY_CONVERSIONS } from './conversion-buckets';

export type LinkMetric = keyof ConversionCounts | 'clicks' | 'pageviews' | 'visitors';
export type LinkCounts = Record<LinkMetric, number>;
export interface LinkPerformance extends LinkCounts {
  id: string;
  label: string;
  url: string | null;
  /** Exact campaign UTM tuple; null for the unknown bucket. */
  tags: string[] | null;
}
export const UNKNOWN_LINK = 'unknown';
export const EMPTY_LINK_COUNTS: LinkCounts = {
  ...EMPTY_CONVERSIONS,
  clicks: 0,
  pageviews: 0,
  visitors: 0,
};
export const LINK_METRICS = Object.keys(EMPTY_LINK_COUNTS) as LinkMetric[];

export function tagsFromUrl(url: string): string[] | null {
  try {
    const params = new URL(url).searchParams;
    return ['source', 'medium', 'content', 'term'].map((field) =>
      (params.get(`utm_${field}`) ?? '').trim().toLowerCase()
    );
  } catch {
    return null;
  }
}

/** A conversion is assigned only when its complete UTM tuple names one link. */
export function matchLink(links: LinkPerformance[], tags: string[]): LinkPerformance | undefined {
  if (!tags[0]) return undefined;
  const matches = links.filter((link) => link.tags?.every((tag, index) => tag === tags[index]));
  return matches.length === 1 ? matches[0] : undefined;
}

export function reconcileLinks(links: LinkPerformance[], totals: LinkCounts): LinkPerformance[] {
  const result = links.map((link) => ({ ...link }));
  const unknown: LinkPerformance = {
    ...EMPTY_LINK_COUNTS,
    id: UNKNOWN_LINK,
    label: 'Unknown link',
    url: null,
    tags: null,
  };
  for (const metric of LINK_METRICS) {
    const known = result.reduce((sum, link) => sum + link[metric], 0);
    // A truncated or inconsistent analytics result must not overclaim credit.
    if (known > totals[metric]) {
      for (const link of result) link[metric] = 0;
      unknown[metric] = totals[metric];
    } else unknown[metric] = totals[metric] - known;
  }
  return [...result, unknown];
}

export function linkColor(id: string): string {
  if (id === UNKNOWN_LINK) return '#737373';
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `hsl(${(Math.imul(hash, 137) >>> 0) % 360} 65% 65%)`;
}
