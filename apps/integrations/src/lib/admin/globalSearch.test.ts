import { describe, expect, it } from 'vitest';
import {
  ADMIN_TOOLS,
  BUSINESS_TOOL,
  type SearchPage,
  searchablePages,
  USERS_TOOL,
} from '@/components/admin/adminTools';
import type { BoardRow } from '@/lib/db';
import {
  askHref,
  buildItems,
  matchPages,
  noteHref,
  type SearchResponse,
  sopEntryHref,
  taskHref,
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
    expect(hrefs).toContain('/admin/campaigns/new');
    expect(hrefs).toContain('/admin/campaigns/performance');
    expect(hrefs).toContain('/admin/campaigns/shortlinks');
    expect(pages.find((page) => page.href === '/admin/schedule/hours')?.hint).toBe(
      'Staff Schedule'
    );
  });

  it('drops sub-pages whose tool the user does not hold, and admin-only ones', () => {
    const water = ADMIN_TOOLS.filter((tool) => tool.href === '/admin/water');
    const hrefs = searchablePages(water, false).map((page) => page.href);
    expect(hrefs).toEqual(['/admin', '/admin/messages', '/admin/notifications', '/admin/water']);

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
    tasks: [
      {
        id: 't1',
        title: 'Order cold plunge filters',
        boardSlug: 'goals',
        boardName: 'Tasks',
        cardNoun: 'task',
        column: 'This week',
        finished: false,
        owner: 'Marina',
        dueDate: '2026-09-30',
        snippet: null,
      },
      {
        id: 't2',
        title: 'Tub maintenance',
        boardSlug: 'goals',
        boardName: 'Tasks',
        cardNoun: 'task',
        column: 'Done',
        finished: true,
        owner: '',
        dueDate: null,
        snippet: 'Drained the cold plunge and refilled',
      },
    ],
  };

  it('puts pages first, then tasks, then titled SOPs, then entries, then notes', () => {
    const items = buildItems(pages, server, 'cold plunge');
    expect(items.map((item) => `${item.group}:${item.key}`)).toEqual([
      'pages:page:/admin/water',
      'tasks:task:t1',
      'tasks:task:t2',
      'sops:sop:s1',
      'entries:entry:s1:1',
      'entries:entry:s1:2',
      'entries:entry:s2:0',
      'notes:note:n1',
    ]);
  });

  it('links entries to the matched occurrence and notes to their anchor', () => {
    const items = buildItems(pages, server, 'cold plunge');
    expect(items[3].href).toBe('/admin/sops/cold-plunge-care?q=cold+plunge');
    expect(items[4].href).toBe('/admin/sops/cold-plunge-care?q=cold+plunge&m=1');
    expect(items[6].href).toBe('/admin/sops/health-benefits?q=cold+plunge');
    expect(items[7].href).toBe('/admin/shift-notes?q=cold+plunge#note-n1');
  });

  it('links a task to its board with the card open, and says where it sits', () => {
    const items = buildItems(pages, server, 'cold plunge');
    expect(items[1]).toMatchObject({
      href: '/admin/boards/goals#card-t1',
      title: 'Order cold plunge filters',
      hint: 'Tasks · This week',
      meta: 'Marina · due 2026-09-30',
    });
    expect(items[1].snippet).toBeUndefined();
    expect(items[2]).toMatchObject({
      href: '/admin/boards/goals#card-t2',
      hint: 'Tasks · Done',
      meta: 'finished',
      snippet: 'Drained the cold plunge and refilled',
    });
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

    const none = buildItems(
      withAsk,
      { q: 'zzz', sops: [], notes: [], tasks: [] },
      'why is the tub cloudy'
    );
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

  it('opens a task through the board hash BoardView reads', () => {
    expect(taskHref('rentals', 'c1')).toBe('/admin/boards/rentals#card-c1');
  });
});

describe('quick task creation', () => {
  const taskBoard = {
    slug: 'goals',
    name: 'Task board',
    description: '',
    archived: false,
    include_in_all_tasks: true,
  } as BoardRow;
  const boards: SearchPage = { href: '/admin/boards', title: 'Boards', hint: '', keywords: [] };

  it('offers creation before search results and carries the trimmed title', () => {
    const items = buildItems([boards], null, '  Order towels  ', [taskBoard]);
    expect(items[0]).toMatchObject({ group: 'create', title: 'Create task: “Order towels”' });
    expect(buildItems([boards], null, '', [taskBoard])[0].title).toBe('Create task');
  });

  it('hides creation for pipeline-only access, archived tasks, or unverified access', () => {
    for (const visible of [
      [],
      [{ ...taskBoard, include_in_all_tasks: false }],
      [{ ...taskBoard, archived: true }],
    ]) {
      expect(buildItems([boards], null, '', visible).some((item) => item.group === 'create')).toBe(
        false
      );
    }
  });

  it('does not offer creation without board access', () => {
    expect(buildItems([], null, 'Order towels')).toEqual([]);
  });
});

describe('board search', () => {
  const boards = [
    {
      id: '1',
      slug: 'rentals',
      name: 'Private Events',
      description: 'Venue bookings',
      archived: false,
      include_in_all_tasks: false,
    },
    {
      id: '2',
      slug: 'old-events',
      name: 'Past Events',
      description: '',
      archived: true,
      include_in_all_tasks: false,
    },
  ] as BoardRow[];

  it('matches names, slugs, and descriptions without requiring a content-search response', () => {
    for (const query of ['private', 'RENTALS', 'venue']) {
      expect(buildItems([], null, query, boards)).toMatchObject([
        { group: 'boards', title: 'Private Events', href: '/admin/boards/rentals' },
      ]);
    }
  });

  it('lists accessible pipelines without granting task creation and labels archived boards', () => {
    const items = buildItems([], null, '', boards);
    expect(items.map((item) => item.group)).toEqual(['boards', 'boards']);
    expect(items[1].hint).toBe('Archived board');
    expect(buildItems([], null, 'unrelated', boards)).toEqual([]);
    expect(buildItems([], null, 'events', [])).toEqual([]);
  });

  it('avoids duplicate page links and puts boards before content results', () => {
    const pages: SearchPage[] = [
      { href: '/admin/boards/rentals', title: 'Private Events', hint: '', keywords: [] },
    ];
    const items = buildItems(
      pages,
      {
        q: 'events',
        sops: [],
        tasks: [],
        notes: [
          { id: 'n', note_date: '2026-09-21', author_email: 'a', author: 'A', snippet: 'events' },
        ],
      },
      'events',
      boards
    );
    expect(items.map((item) => item.group)).toEqual(['boards', 'boards', 'notes']);
    expect(items.filter((item) => item.href === '/admin/boards/rentals')).toHaveLength(1);
  });
});
