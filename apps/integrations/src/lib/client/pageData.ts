// Which JSON each admin page reads first, by pathname — so the data can be
// warmed into the lib/client/cachedJson cache before the page's island
// mounts. AdminLayout warms a page's URLs when a link to it is hovered,
// touched, or focused, and again when a navigation to it starts; by the
// time the ClientRouter has swapped the document and the island hydrates,
// its first read is a cache hit younger than FRESH_MS, and it paints at
// once with nothing to revalidate.
//
// Every URL here must be byte-for-byte the one the island requests on
// mount (the cache is keyed by full URL), so each entry names the island it
// mirrors. A page whose first read depends on state the island keeps
// (a saved view in localStorage, a filter) has no entry; a wrong guess would
// only cost a wasted request, but a right one is a free paint.
//
// Client-bundle-safe: nothing here touches the server.

import { addDays, todayEastern, weekStartOf } from '@pyre/schedule-core';

/** Prefix of every route the admin islands read. */
const API = '/api/admin';

/** A page's first reads, given its pathname and query. */
type Rule = (match: RegExpMatchArray, search: URLSearchParams) => string[];

/** The Monday-to-Sunday week around `date`, as the schedule board asks for it. */
function weekRange(date: string): { start: string; end: string } {
  const start = weekStartOf(date);
  return { start, end: addDays(start, 6) };
}

/** The month grid around `date`: the Monday on/before the 1st to the Sunday on/after the last day. */
function monthGrid(date: string): { start: string; end: string } {
  const monthStart = `${date.slice(0, 7)}-01`;
  const next = new Date(`${monthStart}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthEnd = addDays(next.toISOString().slice(0, 10), -1);
  return { start: weekStartOf(monthStart), end: addDays(weekStartOf(monthEnd), 6) };
}

const RULES: Array<[RegExp, Rule]> = [
  // ScheduleBoard: the current week, drafts included; beside it the duty
  // definitions and training the board decorates shifts with.
  [
    /^\/admin\/schedule$/,
    (_m, search) => {
      const date = search.get('date') ?? todayEastern();
      const { start, end } = weekRange(date);
      return [
        `${API}/schedule-board?start=${start}&end=${end}&includeDrafts=1`,
        `${API}/shift-duties`,
      ];
    },
  ],
  // ScheduleCalendar: this month's grid (shares the board cache with the week).
  [
    /^\/admin\/schedule\/calendar$/,
    () => {
      const { start, end } = monthGrid(todayEastern());
      return [`${API}/schedule-board?start=${start}&end=${end}`, `${API}/shift-duties`];
    },
  ],
  [/^\/admin\/schedule\/duties$/, () => [`${API}/shift-duties`]],
  [/^\/admin\/schedule-lint$/, () => [`${API}/schedule-lint`]],
  [/^\/admin\/water$/, () => [`${API}/cold-plunges`]],
  [/^\/admin\/water\/plunges$/, () => [`${API}/cold-plunges`]],
  [/^\/admin\/inventory$/, () => [`${API}/inventory`]],
  [/^\/admin\/sops$/, () => [`${API}/sops`, `${API}/sop-runs?view=active`]],
  [/^\/admin\/sops\/runs$/, () => [`${API}/sop-runs?view=list`]],
  // Pages that build their URL from an empty URLSearchParams keep its
  // trailing '?': the key must match the island's request byte for byte.
  [/^\/admin\/ask\/log$/, () => [`${API}/knowledge-log?`]],
  [/^\/admin\/schedule\/changes$/, () => [`${API}/schedule-changes?`]],
  [/^\/admin\/suggestions$/, () => [`${API}/suggestions?status=pending`]],
  [/^\/admin\/ask$/, () => [`${API}/knowledge-history`]],
  [/^\/admin\/ask\/routines$/, () => [`${API}/agent-routines`]],
  [/^\/admin\/boards$/, () => [`${API}/boards`]],
  [/^\/admin\/boards\/all-goals$/, () => [`${API}/goals`]],
  [/^\/admin\/boards\/([^/]+)$/, (m) => [`${API}/board-cards?board=${encodeURIComponent(m[1])}`]],
  [/^\/admin\/guests$/, () => [`${API}/guests`]],
  [/^\/admin\/guests\/fields$/, () => [`${API}/guest-fields`]],
  [/^\/admin\/guests\/sessions$/, () => [`${API}/guest-sessions?date=${todayEastern()}`]],
  [/^\/admin\/lost-found$/, () => [`${API}/lost-found?status=on_hand`]],
  [/^\/admin\/shift-notes$/, () => [`${API}/shift-notes`]],
  [/^\/admin\/messages$/, () => [`${API}/messages`]],
  [/^\/admin\/messages\/templates$/, () => [`${API}/message-templates`, `${API}/messages`]],
  [/^\/admin\/users$/, () => [`${API}/users`]],
  [/^\/admin\/partners$/, () => [`${API}/partners`]],
  [/^\/admin\/referrals$/, () => [`${API}/referrals?`]],
  [/^\/admin\/email$/, () => [`${API}/email-stats?days=14`]],
  [/^\/admin\/webhooks$/, () => [`${API}/webhook-stats?days=30`]],
  [/^\/admin\/campaigns$/, () => [`${API}/campaigns?status=active`]],
  [/^\/admin\/campaigns\/shortlinks$/, () => [`${API}/shortlinks`]],
  [/^\/admin\/journeys$/, () => [`${API}/journeys`]],
];

/**
 * The URLs to warm for a navigation to `pathname` (with its query string's
 * params), or [] for a page whose first read cannot be known from the link.
 */
export function jsonUrlsFor(
  pathname: string,
  search: URLSearchParams = new URLSearchParams()
): string[] {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  for (const [pattern, rule] of RULES) {
    const match = path.match(pattern);
    if (match) return rule(match, search);
  }
  return [];
}

/** Whether a link is worth warming: same origin, an admin page, not the logout. */
export function isWarmableHref(href: string, origin: string): URL | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (!(url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return null;
  return url;
}
