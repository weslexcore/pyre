import { useEffect, useRef, useState } from 'react';
import { ADMIN_TOOL_SECTIONS, type AdminTool } from './adminTools';

interface AdminNavProps {
  currentPath: string;
  userEmail: string;
  /** Pre-filtered by AdminLayout to the tools this user may view. */
  tools: AdminTool[];
}

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  /** Section heading, or null for the ungrouped links at the top. */
  label: string | null;
  items: NavItem[];
}

function isActive(currentPath: string, href: string): boolean {
  // The dashboard is the parent of every tool page, so it only counts as
  // active on an exact match.
  if (href === '/admin') return currentPath === '/admin' || currentPath === '/admin/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

const LINK_BASE =
  'rounded-md border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wide transition-colors';
const LINK_IDLE =
  'border-white/20 text-[var(--pyre-creme)] hover:border-white/40 hover:bg-white/10';

/**
 * Shared admin nav: a single menu button at every breakpoint that opens a
 * dropdown of the tools this user may view — full-width on mobile, anchored
 * to the right on md+. The panel anchors to the sticky header, which
 * AdminLayout marks `position: relative`.
 *
 * The tools are grouped under the same section headings, in the same order,
 * as the cards on the /admin dashboard, so the menu reads as that same
 * directory in a narrower shape.
 */
export function AdminNav({ currentPath, userEmail, tools }: AdminNavProps) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  const groups: NavGroup[] = [
    { label: null, items: [{ href: '/admin', label: 'Home' }] },
    ...ADMIN_TOOL_SECTIONS.map((section) => ({
      label: section.label,
      items: tools
        .filter((tool) => tool.section === section.key)
        .map((tool) => ({ href: tool.href, label: tool.title })),
    })).filter((group) => group.items.length > 0),
  ];
  // Label the button with where you are, since there is no active chip now.
  const currentLabel =
    groups.flatMap((group) => group.items).find((item) => isActive(currentPath, item.href))
      ?.label ?? 'Menu';

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <nav ref={navRef} aria-label="Admin tools">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-menu"
        aria-label={open ? 'Close admin menu' : 'Open admin menu'}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center gap-2 rounded-md border border-white/20 text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10 md:w-auto md:px-3"
      >
        {open ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M3 3l12 12M15 3L3 15"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 14" fill="none" aria-hidden="true">
            <path
              d="M1 1h16M1 7h16M1 13h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span className="hidden font-mono text-xs font-bold uppercase tracking-wide md:inline">
          {currentLabel}
        </span>
      </button>

      {open && (
        <div
          id="admin-menu"
          // The panel hangs off a sticky header, so anything past the bottom
          // of the viewport can never be scrolled to — the header (and the
          // panel with it) stays put as the page scrolls. Cap the panel at
          // the space below the header and scroll the list inside it instead,
          // keeping the account row pinned to the bottom. overscroll-contain
          // stops that scroll from chaining to the page behind the menu.
          className="absolute inset-x-0 top-full z-50 flex max-h-[calc(100dvh-4.25rem)] flex-col border-t border-white/10 bg-[var(--pyre-black)] shadow-lg md:inset-x-auto md:right-4 md:mt-2 md:max-h-[calc(100dvh-5rem)] md:w-64 md:rounded-md md:border md:border-white/10"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2 md:px-2">
            {groups.map((group) => (
              <div key={group.label ?? 'home'} className="mt-3 first:mt-0">
                {group.label && (
                  <div className="pb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white/40 md:px-2">
                    {group.label}
                  </div>
                )}
                <ul>
                  {group.items.map((item) => (
                    <li
                      key={item.href}
                      className="border-b border-white/5 last:border-b-0 md:border-b-0"
                    >
                      <a
                        href={item.href}
                        // "tap" (not the default "hover"): Astro binds hover
                        // listeners by walking the DOM on astro:page-load, which
                        // misses these — the dropdown only renders once opened.
                        // The tap strategy is delegated on document, so it catches
                        // client-rendered links and still fires on mousedown,
                        // before the click completes.
                        data-astro-prefetch="tap"
                        aria-current={isActive(currentPath, item.href) ? 'page' : undefined}
                        className={`block rounded py-3 font-mono text-sm font-bold uppercase tracking-wide transition-colors md:px-2 md:py-2 md:text-xs md:hover:bg-white/10 ${
                          isActive(currentPath, item.href)
                            ? 'text-[var(--pyre-red)]'
                            : 'text-[var(--pyre-creme)] hover:text-white'
                        }`}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-4 py-3 md:px-3">
            <span className="truncate font-mono text-xs text-white/40">{userEmail}</span>
            {/* Never prefetch: logout is a GET that clears the session
                cookies, so fetching it in the background signs the user out.
                Explicit "false" keeps that true even if someone later turns
                on prefetchAll.
                data-astro-reload forces a full navigation rather than a
                client-side swap, which tears down the JS realm — otherwise
                the lib/client/cachedJson entries would outlive the session
                in memory, on studio machines people share. */}
            <a
              href="/api/auth/logout"
              data-astro-prefetch="false"
              data-astro-reload
              className={`${LINK_BASE} ${LINK_IDLE} shrink-0`}
            >
              Log Out
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
