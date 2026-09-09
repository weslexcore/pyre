// How a generated link reads in a list: its placement, and for the two
// placements whose utm_source is not fixed (partner share, custom) the
// values that tell one apart from the next. Shared by the detail page, the
// per-campaign stats, and the cross-campaign report.

import type { UtmLink } from '@pyre/webhook-core';
import { placementByKey } from './placements';

export function describeLink(
  link: Pick<UtmLink, 'placementKey' | 'variant' | 'source' | 'medium' | 'content'>
): string {
  const placement = placementByKey(link.placementKey);
  let base: string;
  if (!placement || placement.custom) {
    const parts = [link.source, link.medium, link.content].filter(Boolean);
    base = parts.length ? `Custom: ${parts.join(' / ')}` : 'Custom';
  } else if (placement.askSource) {
    base = link.source ? `${placement.label}: ${link.source}` : placement.label;
  } else {
    base = placement.label;
  }
  return link.variant ? `${base} (${link.variant})` : base;
}
