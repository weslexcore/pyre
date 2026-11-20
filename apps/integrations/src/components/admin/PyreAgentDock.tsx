// Pyre Agent from any admin page: a launcher in the bottom-right corner that
// opens the chat as a window beside the page on desktop, and as a
// full-screen modal on a phone. The chat itself is SopAsk in its 'dock'
// variant, so this file is only the shell around it.
//
// The chat outlives closing the window and changing pages. AdminLayout
// mounts this island with transition:persist, so the ClientRouter carries the
// same React tree (and the answer being streamed into it) from page to page;
// Close only hides the window. A hard reload drops the stream, but SopAsk
// restores the open conversation from localStorage and reattaches to a live
// answer, as the full page does.
//
// The chat is mounted the first time the window opens — nobody pays for the
// history fetch until they want it — and stays mounted after that. On
// /admin/ask the page is the chat, so the dock steps aside there: it hides,
// and once idle it lets its copy go, so coming back out mounts a fresh one
// that opens whatever conversation the full page left open.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SopAsk } from './SopAsk';

/** Whether the window was open, so a reload of the same tab keeps it open. */
const OPEN_KEY = 'pyre-agent:dock-open';
const ASK_PATH = '/admin/ask';
/** Below Tailwind's md breakpoint the window is a full-screen modal. */
const PHONE_QUERY = '(max-width: 47.99rem)';

function readOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    if (open) window.sessionStorage.setItem(OPEN_KEY, '1');
    else window.sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage unavailable: the window just starts closed after a reload.
  }
}

function isPhone(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}

const headerButtonClass =
  'rounded border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-white/70 transition-colors hover:border-white/30 hover:text-white';

interface Props {
  isAdmin?: boolean;
  hasBoards?: boolean;
}

export function PyreAgentDock({ isAdmin = false, hasBoards = false }: Props) {
  const [open, setOpenState] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [onAskPage, setOnAskPage] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) setMounted(true);
    writeOpen(next);
  }, []);

  // First paint: reopen if this tab had the window open, and note the page.
  useEffect(() => {
    setOnAskPage(window.location.pathname === ASK_PATH);
    if (readOpen() && window.location.pathname !== ASK_PATH) {
      setOpenState(true);
      setMounted(true);
    }
  }, []);

  // Each ClientRouter navigation. `document` outlives the swap, so this
  // listener is registered once for the life of the island. On a phone the
  // modal covers the page, so following a link out of an answer closes it to
  // show where the link went; on desktop the window stays beside the page.
  useEffect(() => {
    const onSwap = () => {
      const askPage = window.location.pathname === ASK_PATH;
      setOnAskPage(askPage);
      if (askPage || isPhone()) {
        setOpenState(false);
        writeOpen(false);
      }
    };
    document.addEventListener('astro:after-swap', onSwap);
    return () => document.removeEventListener('astro:after-swap', onSwap);
  }, []);

  // On the full page, let go of the docked chat once nothing is streaming
  // into it; leaving the page mounts a fresh one from what the page left.
  useEffect(() => {
    if (onAskPage && !busy) setMounted(false);
  }, [onAskPage, busy]);

  const visible = open && !onAskPage;

  // The phone modal covers the page, so the page under it must not scroll.
  // <html> rather than <body>: the router swaps <body> on every navigation.
  useEffect(() => {
    if (!visible || !isPhone()) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [visible]);

  // Opening puts the cursor in the composer on desktop (a phone would pop the
  // keyboard over the examples); closing hands focus back to the launcher.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current && !isPhone()) {
      requestAnimationFrame(() => {
        panelRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      });
    } else if (!visible && wasVisible.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        launcherRef.current?.focus({ preventScroll: true });
      }
    }
    wasVisible.current = visible;
  }, [visible]);

  if (onAskPage && !mounted) return null;

  return (
    <>
      {!visible && !onAskPage && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-controls="pyre-agent-dock"
          className="pyre-agent-launcher fixed right-4 z-30 flex items-center gap-2 rounded-full border border-[var(--pyre-gold)]/60 bg-[var(--pyre-black)] px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)] shadow-lg shadow-black/40 transition-colors hover:border-[var(--pyre-gold)] hover:bg-[var(--pyre-gold)]/10"
        >
          Pyre Agent
          {busy && (
            <span className="relative flex h-2 w-2">
              <span className="sr-only">(writing an answer)</span>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pyre-gold)] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--pyre-gold)]" />
            </span>
          )}
        </button>
      )}

      {mounted && (
        <div
          id="pyre-agent-dock"
          ref={panelRef}
          role="dialog"
          aria-label="Pyre Agent"
          aria-hidden={!visible}
          inert={!visible}
          className={`pyre-agent-window fixed inset-0 z-[45] flex-col bg-[var(--pyre-black)] pb-[env(safe-area-inset-bottom)] md:inset-auto md:right-4 md:z-30 md:h-[min(680px,calc(100dvh-6rem))] md:w-[420px] md:overflow-hidden md:rounded-lg md:border md:border-white/15 md:pb-0 md:shadow-2xl md:shadow-black/50 ${
            visible ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:pt-2">
            <span className="font-mono text-xs uppercase tracking-wide text-[var(--pyre-gold)]">
              Pyre Agent
            </span>
            <div className="flex items-center gap-2">
              <a href={ASK_PATH} data-astro-prefetch className={headerButtonClass}>
                Full page
              </a>
              <button type="button" className={headerButtonClass} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <SopAsk variant="dock" isAdmin={isAdmin} hasBoards={hasBoards} onBusyChange={setBusy} />
          </div>
        </div>
      )}
    </>
  );
}
