// Global search for the admin dashboard: cmd+K (ctrl+K elsewhere) or the
// magnifier button in the header opens a palette that finds pages first, then
// SOP documents, the matched lines inside them, and shift notes. Pages match
// locally from the list AdminLayout hands over (already filtered to what this
// user may open); the rest comes from /api/admin/search, which applies each
// tool's own access rules. Results are one keyboard-navigable list — arrows
// move, Enter opens, Escape closes — and every row is a real link, so the
// ClientRouter handles the navigation exactly as it does for the menu.
//
// Opening an SOP entry lands on that very match (?q= highlights, &m= picks
// the occurrence); a shift note opens the log filtered to the term, scrolled
// to that note. Anyone who holds the Ask page also gets an "Ask a question"
// row last, which opens the Ask page and puts the typed text to the
// knowledge assistant — the semantic search, where the rows above are exact. Modal mechanics follow SopPeekModal (backdrop button, Escape,
// full-screen sheet on mobile).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildItems,
  GROUP_LABELS,
  MIN_QUERY_LENGTH,
  queryLength,
  type SearchGroup,
  type SearchItem,
  type SearchResponse,
} from '@/lib/admin/globalSearch';
import type { SearchPage } from './adminTools';
import { Marked } from './Marked';

const GROUP_ORDER: SearchGroup[] = ['pages', 'sops', 'entries', 'notes', 'ask'];

// One brand color per group heading (text, underline, and dot), so where one
// group ends and the next begins reads at a glance even in a long list; the
// rows themselves stay neutral. Pages take the red the nav uses for "where
// you are"; the two SOP groups share gold (the library's own accent), the
// entries a step dimmer; shift notes take sage.
const GROUP_STYLE: Record<SearchGroup, { heading: string; badge: string }> = {
  pages: {
    heading: 'text-[var(--pyre-red)] border-[var(--pyre-red)]/40',
    badge: 'bg-[var(--pyre-red)]',
  },
  sops: {
    heading: 'text-[var(--pyre-gold)] border-[var(--pyre-gold)]/40',
    badge: 'bg-[var(--pyre-gold)]',
  },
  entries: {
    heading: 'text-[var(--pyre-gold)]/80 border-[var(--pyre-gold)]/30',
    badge: 'bg-[var(--pyre-gold)]/60',
  },
  notes: {
    heading: 'text-[var(--pyre-sage)] border-[var(--pyre-sage)]/40',
    badge: 'bg-[var(--pyre-sage)]',
  },
  ask: {
    heading: 'text-[var(--pyre-creme)] border-white/30',
    badge: 'bg-[var(--pyre-creme)]',
  },
};
const LIST_ID = 'global-search-list';

function optionId(index: number): string {
  return `global-search-option-${index}`;
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** The rows of the palette, grouped under headings, with one flat index. */
export function SearchResults({
  items,
  term,
  selected,
  onSelect,
  onOpen,
}: {
  items: SearchItem[];
  term: string;
  selected: number;
  onSelect: (index: number) => void;
  onOpen: () => void;
}) {
  return (
    <>
      {GROUP_ORDER.map((group) => {
        const rows = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.group === group);
        if (rows.length === 0) return null;
        const style = GROUP_STYLE[group];
        return (
          <section key={group} className="mt-4 first:mt-0" aria-label={GROUP_LABELS[group]}>
            <h3
              className={`mb-1 flex items-center gap-2 border-b px-2 pb-1 font-mono text-[10px] font-bold uppercase tracking-wide ${style.heading}`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${style.badge}`}
                aria-hidden="true"
              />
              {GROUP_LABELS[group]}
              <span className="font-normal opacity-60">{rows.length}</span>
            </h3>
            <ul className="space-y-0.5">
              {rows.map(({ item, index }) => {
                const active = index === selected;
                return (
                  <li key={item.key}>
                    <a
                      id={optionId(index)}
                      href={item.href}
                      data-index={index}
                      data-astro-prefetch="tap"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => onSelect(index)}
                      onClick={onOpen}
                      className={`block rounded px-2 py-2 transition-colors ${
                        active ? 'bg-white/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={`text-sm font-semibold ${
                            active ? 'text-white' : 'text-[var(--pyre-creme)]'
                          }`}
                        >
                          {group === 'entries' || group === 'notes' || group === 'ask' ? (
                            item.title
                          ) : (
                            <Marked text={item.title} term={term} />
                          )}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                          {item.hint}
                          {item.meta ? ` · ${item.meta}` : ''}
                        </span>
                      </div>
                      {item.snippet && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-white/60">
                          <Marked text={item.snippet} term={term} />
                        </p>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function GlobalSearch({ pages }: { pages: SearchPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [server, setServer] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const term = query.trim();
  const contentSearch = queryLength(term) >= MIN_QUERY_LENGTH;

  // cmd+K / ctrl+K anywhere on the page toggles the palette. The island is
  // remounted on every ClientRouter navigation, so the listener is always
  // bound to the current document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Debounced content search. Stale results stay on screen until the next
  // response lands, so the list doesn't blink between keystrokes; an aborted
  // request never writes.
  useEffect(() => {
    if (!open || !contentSearch) {
      setServer(null);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(await readError(res));
        const body = (await res.json()) as SearchResponse;
        setServer(body);
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, contentSearch, term]);

  const items = useMemo(() => buildItems(pages, server, query), [pages, server, query]);

  // A new query starts the cursor back at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is keyed on the query on purpose
  useEffect(() => setSelected(0), [term]);

  // Clamp when results shrink under the cursor.
  const cursor = items.length === 0 ? 0 : Math.min(selected, items.length - 1);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const close = () => setOpen(false);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length > 0) setSelected((cursor + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length > 0) setSelected((cursor - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Clicking the real link hands the navigation to the ClientRouter
      // (and its prefetch), the same as a pointer would.
      listRef.current?.querySelector<HTMLAnchorElement>(`[data-index="${cursor}"]`)?.click();
    }
  };

  // What to say under the input when there are no rows to show (the Ask row
  // doesn't count — it is the offer to make when nothing matched).
  const matched = items.filter((item) => item.group !== 'ask').length;
  const status = !contentSearch
    ? term
      ? `Keep typing — ${MIN_QUERY_LENGTH} characters searches SOPs and shift notes too.`
      : null
    : error
      ? error
      : searching && server === null
        ? 'Searching…'
        : matched === 0
          ? `No matches for “${term}”.`
          : null;

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Search (cmd+K)"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/20 text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10"
      >
        <SearchIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center sm:p-4 sm:pt-[12vh]">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close search"
            onClick={close}
            className="absolute inset-0 h-full w-full cursor-default bg-black/70"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="relative flex h-full w-full max-w-xl flex-col bg-[var(--pyre-black)] shadow-xl sm:h-auto sm:max-h-[70vh] sm:rounded-lg sm:border sm:border-white/15"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <span className="shrink-0 text-white/40">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={LIST_ID}
                aria-activedescendant={items.length > 0 ? optionId(cursor) : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search pages, SOPs, and shift notes…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                className="min-w-0 flex-1 bg-transparent py-2 text-base text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none sm:text-sm"
              />
              {searching && contentSearch && (
                <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/40 sm:inline">
                  searching
                </span>
              )}
              <button
                type="button"
                onClick={close}
                className="shrink-0 rounded border border-white/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/60 transition-colors hover:border-white/40 hover:text-white"
              >
                <span className="sm:hidden">Close</span>
                <span className="hidden sm:inline">esc</span>
              </button>
            </div>

            <div
              ref={listRef}
              id={LIST_ID}
              role="listbox"
              aria-label="Search results"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
            >
              {status && <p className="px-2 py-3 text-sm text-white/60">{status}</p>}
              <SearchResults
                items={items}
                term={term}
                selected={cursor}
                onSelect={setSelected}
                onOpen={close}
              />
            </div>

            <div className="hidden shrink-0 gap-4 border-t border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-white/40 sm:flex">
              <span>↑ ↓ move</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
