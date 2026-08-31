// Per-user pin list for the /admin dashboard: which tool cards sit in the
// Pinned section, and in what order (a plain array of tool hrefs, first =
// top). Client-bundle-safe pure functions shared by the dashboard island and
// the nav menu; the server read side lives in ./toolPins.

/**
 * CustomEvent fired on `document` by the dashboard island after a saved pin
 * change (detail: the saved href list), so the AdminNav menu on the same page
 * updates without a navigation.
 */
export const TOOL_PINS_EVENT = 'pyre:tool-pins';

/** Dedupe (first occurrence wins) and drop hrefs not in `validHrefs`,
 * preserving pin order — scrubs stale rows for tools that were renamed,
 * removed, or that the user can no longer view. */
export function normalizePins(pinned: string[], validHrefs: string[]): string[] {
  const valid = new Set(validHrefs);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const href of pinned) {
    if (!valid.has(href) || seen.has(href)) continue;
    seen.add(href);
    next.push(href);
  }
  return next;
}

/**
 * Move the dragged href to the position of `targetHref`. Dragging downward
 * lands after the target, upward before it — the standard sortable-list feel
 * (same algorithm as repositionCategory in lib/sops/order).
 */
export function repositionPin(hrefs: string[], dragHref: string, targetHref: string): string[] {
  if (dragHref === targetHref) return hrefs;
  const from = hrefs.indexOf(dragHref);
  const to = hrefs.indexOf(targetHref);
  if (from < 0 || to < 0) return hrefs;

  const next = [...hrefs];
  next.splice(from, 1);
  const insertAt = next.indexOf(targetHref);
  next.splice(from < to ? insertAt + 1 : insertAt, 0, dragHref);
  return next;
}

/** Toggle `href` in the pin list: append to the end when absent, remove when
 * present. */
export function togglePin(hrefs: string[], href: string): string[] {
  return hrefs.includes(href) ? hrefs.filter((h) => h !== href) : [...hrefs, href];
}
