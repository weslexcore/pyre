import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOOLS,
  BUSINESS_TOOL,
  type SearchPage,
  searchablePages,
  USERS_TOOL,
} from '@/components/admin/adminTools';
import {
  askHref,
  buildItems,
  matchPages,
  noteHref,
  type SearchResponse,
  sopEntryHref,
} from './globalSearch';

const ALL_TOOLS = [...ADMIN_TOOLS, USERS_TOOL, BUSINESS_TOOL];

describe('searchablePages', () => {
  it('lists the dashboard, every tool, and the sub-pages under held tools', () => {
    const pages = searchablePages(ALL_TOOLS, true);
    const hrefs = pages.map((page) => page.href);
    expect(hrefs[0]).toBe('/admin');
    expect(hrefs).toContain('/admin/water');
    expect(hrefs).toContain('/admin/schedule/hours');
    expect(hrefs).toContain('/admin/sops/runs');
    expect(hrefs).toContain('/admin/ask/log');
    expect(pages.find((page) => page.href === '/admin/schedule/hours')?.hint).toBe(
      'Staff Schedule'
    );
  });

  it('drops sub-pages whose tool the user does not hold, and admin-only ones', () => {
    const water = ADMIN_TOOLS.filter((tool) => tool.href === '/admin/water');
    const hrefs = searchablePages(water, false).map((page) => page.href);
    expect(hrefs).toEqual(['/admin', '/admin/water']);

    const schedule = ADMIN_TOOLS.filter((tool) => tool.href === '/admin/schedule');
    const staffHrefs = searchablePages(schedule, false).map((page) => page.href);
    expect(staffHrefs).toContain('/admin/schedule/hours');
    expect(staffHrefs).not.toContain('/admin/schedule/insights');
  });
});

describe('matchPages', () => {
  const pages = searchablePages(ALL_TOOLS, true);

  it('finds the water log by its cold plunge alias', () => {
    const [first] = matchPages(pages, 'Cold Plunge');
    expect(first?.href).toBe('/admin/water');
  });

  it('ranks a title that starts with the term above one that merely contains it', () => {
    const custom: SearchPage[] = [
      { href: '/b', title: 'Weekly Schedule', hint: '', keywords: [] },
      { href: '/a', title: 'Schedule Board', hint: '', keywords: [] },
      { href: '/c', title: 'Hours', hint: '', keywords: ['schedule'] },
      { href: '/d', title: 'People', hint: '', description: 'who to schedule', keywords: [] },
    ];
    expect(matchPages(custom, 'schedule').map((page) => page.href)).toEqual([
      '/a',
      '/b',
      '/c',
      '/d',
    ]);
  });

  it('returns nothing for an empty query', () => {
    expect(matchPages(pages, '  ')).toEqual([]);
  });
});

describe('buildItems', () => {
  const pages: SearchPage[] = [
    { href: '/admin', title: 'Home', hint: 'Dashboard', keywords: [] },
    {
      href: '/admin/water',
      title: 'Cold Tub Water Log',
      hint: 'Operations',
      keywords: ['cold plunge'],
    },
    { href: '/admin/sops', title: 'SOPs', hint: 'Operations', keywords: [] },
  ];
  const server: SearchResponse = {
    q: 'cold plunge',
    sops: [
      {
        id: 's1',
        slug: 'cold-plunge-care',
        title: 'Cold Plunge Care',
        category: 'Operations',
        archived: false,
        titleMatch: true,
        matchCount: 3,
        entries: [
          { text: 'Test the cold plunge every morning', ordinal: 1 },
          { text: 'Drain the cold plunge weekly', ordinal: 2 },
        ],
      },
      {
        id: 's2',
        slug: 'health-benefits',
        title: 'Health Benefits',
        category: 'Health & Science',
        archived: false,
        titleMatch: false,
        matchCount: 1,
        entries: [{ text: 'A cold plunge after the sauna…', ordinal: 0 }],
      },
    ],
    notes: [
      {
        id: 'n1',
        note_date: '2026-09-01',
        author_email: 'marina@pyresauna.com',
        author: 'Marina',
        snippet: 'The cold plunge was cloudy tonight.',
      },
    ],
  };

  it('puts pages first, then titled SOPs, then entries, then notes', () => {
    const items = buildItems(pages, server, 'cold plunge');
    expect(items.map((item) => `${item.group}:${item.key}`)).toEqual([
      'pages:page:/admin/water',
      'sops:sop:s1',
      'entries:entry:s1:1',
      'entries:entry:s1:2',
      'entries:entry:s2:0',
      'notes:note:n1',
    ]);
  });

  it('links entries to the matched occurrence and notes to their anchor', () => {
    const items = buildItems(pages, server, 'cold plunge');
    expect(items[1].href).toBe('/admin/sops/cold-plunge-care?q=cold+plunge');
    expect(items[2].href).toBe('/admin/sops/cold-plunge-care?q=cold+plunge&m=1');
    expect(items[4].href).toBe('/admin/sops/health-benefits?q=cold+plunge');
    expect(items[5].href).toBe('/admin/shift-notes?q=cold+plunge#note-n1');
  });

  it('lists every page as a jump list when nothing is typed', () => {
    const items = buildItems(pages, server, '');
    expect(items.map((item) => item.href)).toEqual(['/admin', '/admin/water', '/admin/sops']);
  });

  it('starts with an Ask row for anyone who holds the Ask page, even with no matches', () => {
    const withAsk = [
      ...pages,
      { href: '/admin/ask', title: 'Ask a Question', hint: '', keywords: [] },
    ];
    const items = buildItems(withAsk, server, 'cold plunge');
    const [first, second] = items;
    expect(first.group).toBe('ask');
    expect(first.href).toBe('/admin/ask?q=cold+plunge');
    expect(first.title).toBe('Ask a question: “cold plunge”');
    expect(second.group).toBe('pages');

    const none = buildItems(withAsk, { q: 'zzz', sops: [], notes: [] }, 'why is the tub cloudy');
    expect(none.map((item) => item.group)).toEqual(['ask']);
    expect(none[0].href).toBe(askHref('why is the tub cloudy'));
  });

  it('offers no Ask row without the Ask page, or with nothing typed', () => {
    expect(buildItems(pages, server, 'cold plunge').some((item) => item.group === 'ask')).toBe(
      false
    );
    const withAsk = [
      ...pages,
      { href: '/admin/ask', title: 'Ask a Question', hint: '', keywords: [] },
    ];
    expect(buildItems(withAsk, null, '').some((item) => item.group === 'ask')).toBe(false);
  });

  it('shows the page matches alone while the server has not answered', () => {
    const items = buildItems(pages, null, 'sop');
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe('/admin/sops');
  });
});

describe('hrefs', () => {
  it('omits m for the first occurrence', () => {
    expect(sopEntryHref('a', 'x y', 0)).toBe('/admin/sops/a?q=x+y');
    expect(sopEntryHref('a', 'x y', 4)).toBe('/admin/sops/a?q=x+y&m=4');
  });

  it('encodes the note term', () => {
    expect(noteHref('abc', 'pH & chlorine')).toBe('/admin/shift-notes?q=pH+%26+chlorine#note-abc');
  });
});
