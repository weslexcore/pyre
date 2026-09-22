// Static-markup render of the palette's result list: grouped headings in
// order, one flat index across groups, the selected row marked, the term
// highlighted in titles and snippets, and every row a real link.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SearchItem } from '@/lib/admin/globalSearch';
import { GlobalSearch, SearchResults } from './GlobalSearch';

const ITEMS: SearchItem[] = [
  {
    key: 'page:/admin/water',
    group: 'pages',
    href: '/admin/water',
    title: 'Cold Tub Water Log',
    hint: 'Operations',
  },
  {
    key: 'entry:s1:0',
    group: 'entries',
    href: '/admin/sops/care?q=cold',
    title: 'Cold Plunge Care',
    hint: 'Operations',
    snippet: 'Test the cold plunge daily',
  },
  {
    key: 'note:n1',
    group: 'notes',
    href: '/admin/shift-notes?q=cold#note-n1',
    title: 'Marina',
    hint: '2026-09-01',
    snippet: 'The cold plunge was cloudy',
  },
];

describe('SearchResults', () => {
  const html = renderToStaticMarkup(
    <SearchResults items={ITEMS} term="cold" selected={1} onSelect={() => {}} onOpen={() => {}} />
  );

  it('renders the groups in order with their headings', () => {
    const pages = html.indexOf('Pages');
    const entries = html.indexOf('In SOPs');
    const notes = html.indexOf('Shift notes');
    expect(pages).toBeGreaterThan(-1);
    expect(entries).toBeGreaterThan(pages);
    expect(notes).toBeGreaterThan(entries);
    expect(html).not.toContain('>SOPs<');
  });

  it('numbers rows across groups and marks the selected one', () => {
    expect(html).toContain('data-index="0"');
    expect(html).toContain('data-index="2"');
    expect(html).toMatch(/data-index="1"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-index="0"[^>]*aria-selected="false"/);
  });

  it('highlights the term in page titles and in snippets, and links every row', () => {
    expect(html).toContain('<mark');
    expect(html).toContain('>Cold</mark> Tub Water Log');
    expect(html).toContain('Test the <mark');
    expect(html).toContain('href="/admin/shift-notes?q=cold#note-n1"');
    expect(html).toContain('data-astro-prefetch="tap"');
  });
});

describe('SearchResults with an Ask row', () => {
  const html = renderToStaticMarkup(
    <SearchResults
      items={[
        {
          key: 'ask',
          group: 'ask',
          href: '/admin/ask?q=cold',
          title: 'Ask a question: “cold”',
          hint: 'Knowledge assistant',
        },
        ...ITEMS,
      ]}
      term="cold"
      selected={0}
      onSelect={() => {}}
      onOpen={() => {}}
    />
  );

  it('draws the Ask row first, in gold, with no heading', () => {
    expect(html).not.toContain('>Ask<');
    const ask = html.indexOf('data-index="0"');
    const pages = html.indexOf('Pages');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(pages);
    expect(html).toMatch(/data-index="0"[^>]*aria-selected="true"[^>]*pyre-gold/);
    expect(html).toContain('href="/admin/ask?q=cold"');
  });
});

describe('GlobalSearch', () => {
  it('renders only the trigger button while closed', () => {
    const html = renderToStaticMarkup(<GlobalSearch pages={[]} />);
    expect(html).toContain('aria-label="Search"');
    expect(html).not.toContain('role="dialog"');
  });
});

it('renders task creation as a keyboard-indexed action before other results', () => {
  const html = renderToStaticMarkup(
    <SearchResults
      items={[
        {
          key: 'create-task',
          group: 'create',
          href: '/admin/boards/tasks',
          title: 'Create task',
          hint: '',
        },
        ...ITEMS,
      ]}
      term=""
      selected={0}
      onSelect={() => {}}
      onOpen={() => {}}
      onCreate={() => {}}
    />
  );
  expect(html).toMatch(/<button[^>]*data-index="0"[^>]*aria-selected="true"/);
  expect(html.indexOf('Create task')).toBeLessThan(html.indexOf('Pages'));
});

it('renders searchable boards with direct links, highlighting, and keyboard selection', () => {
  const html = renderToStaticMarkup(
    <SearchResults
      items={[
        {
          key: 'board:rentals',
          group: 'boards',
          href: '/admin/boards/rentals',
          title: 'Private Events',
          hint: 'Board',
          snippet: 'Venue bookings',
        },
      ]}
      term="private"
      selected={0}
      onSelect={() => {}}
      onOpen={() => {}}
    />
  );
  expect(html).toContain('aria-label="Boards"');
  expect(html).toContain('href="/admin/boards/rentals"');
  expect(html).toContain('>Private</mark> Events');
  expect(html).toMatch(/data-index="0"[^>]*aria-selected="true"/);
});

it('renders tasks under their own heading, after boards and before SOPs, linked to the card', () => {
  const html = renderToStaticMarkup(
    <SearchResults
      items={[
        {
          key: 'board:goals',
          group: 'boards',
          href: '/admin/boards/goals',
          title: 'Tasks',
          hint: 'Board',
        },
        {
          key: 'task:t1',
          group: 'tasks',
          href: '/admin/boards/goals#card-t1',
          title: 'Order towels',
          hint: 'Tasks · This week',
          meta: 'Marina · due 2026-09-30',
        },
        ITEMS[1],
      ]}
      term="towels"
      selected={1}
      onSelect={() => {}}
      onOpen={() => {}}
    />
  );
  expect(html).toContain('aria-label="Tasks"');
  expect(html.indexOf('aria-label="Boards"')).toBeLessThan(html.indexOf('aria-label="Tasks"'));
  expect(html.indexOf('aria-label="Tasks"')).toBeLessThan(html.indexOf('aria-label="In SOPs"'));
  expect(html).toContain('href="/admin/boards/goals#card-t1"');
  expect(html).toContain('Order <mark');
  expect(html).toContain('Tasks · This week · Marina · due 2026-09-30');
  expect(html).toMatch(/data-index="1"[^>]*aria-selected="true"/);
});
