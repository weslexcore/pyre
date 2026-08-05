import { useState } from 'react';
import type { AdminTool } from './adminTools';

interface AdminNavProps {
  currentPath: string;
  userEmail: string;
  /** Pre-filtered by AdminLayout to the tools this user may view. */
  tools: AdminTool[];
}

function isActive(currentPath: string, href: string): boolean {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

const LINK_BASE =
  'rounded-md border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wide transition-colors';
const LINK_IDLE =
  'border-white/20 text-[var(--pyre-creme)] hover:border-white/40 hover:bg-white/10';
const LINK_ACTIVE = 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]';

/**
 * Shared admin nav: inline links on md+ screens, hamburger + full-width
 * dropdown panel on mobile. The panel anchors to the sticky header, which
 * AdminLayout marks `position: relative`.
 */
export function AdminNav({ currentPath, userEmail, tools }: AdminNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <nav aria-label="Admin tools">
      {/* Desktop */}
      <div className="hidden items-center gap-2 md:flex">
        {tools.map((tool) => (
          <a
            key={tool.href}
            href={tool.href}
            aria-current={isActive(currentPath, tool.href) ? 'page' : undefined}
            className={`${LINK_BASE} ${isActive(currentPath, tool.href) ? LINK_ACTIVE : LINK_IDLE}`}
          >
            {tool.navLabel}
          </a>
        ))}
        <span className="ml-2 hidden font-mono text-xs text-white/40 lg:inline">{userEmail}</span>
        <a href="/api/auth/logout" className={`${LINK_BASE} ${LINK_IDLE}`}>
          Log Out
        </a>
      </div>

      {/* Mobile toggle */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="admin-mobile-menu"
        aria-label={open ? 'Close admin menu' : 'Open admin menu'}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-white/20 text-[var(--pyre-creme)] transition-colors hover:border-white/40 hover:bg-white/10 md:hidden"
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
      </button>

      {/* Mobile dropdown panel */}
      {open && (
        <div
          id="admin-mobile-menu"
          className="absolute inset-x-0 top-full border-t border-white/10 bg-[var(--pyre-black)] shadow-lg md:hidden"
        >
          <ul className="px-4 py-2">
            {tools.map((tool) => (
              <li key={tool.href} className="border-b border-white/5 last:border-b-0">
                <a
                  href={tool.href}
                  aria-current={isActive(currentPath, tool.href) ? 'page' : undefined}
                  className={`block py-3 font-mono text-sm font-bold uppercase tracking-wide transition-colors ${
                    isActive(currentPath, tool.href)
                      ? 'text-[var(--pyre-red)]'
                      : 'text-[var(--pyre-creme)] hover:text-white'
                  }`}
                >
                  {tool.title}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
            <span className="truncate font-mono text-xs text-white/40">{userEmail}</span>
            <a href="/api/auth/logout" className={`${LINK_BASE} ${LINK_IDLE} shrink-0`}>
              Log Out
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
