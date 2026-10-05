// A card opened from wherever the person is. Mounted once in AdminLayout, it
// catches clicks on card links (/admin/boards/<slug>#card-<id>) anywhere in
// admin — search results, notifications, Up next, link chips — and opens the
// card's drawer over the current page instead of going to the board.
//
// A page that already holds the card claims the click first and opens its
// own drawer (cardPeekEvents, useCardDeepLink). Otherwise the peek loads the
// card's board through the same route the board page uses, so access, the
// board's fields, owners and link summaries are exactly what the board would
// show. A modified click (new tab, new window) still goes to the board, and
// a card the peek cannot load falls back to the link it came from. A card
// link inside a peek opens another peek on top of it.

import { navigate } from 'astro:transitions/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type LinkSummary, summariesById } from '@/lib/boards/links';
import type { Assignable } from '@/lib/boards/people';
import { readError, sendJson } from '@/lib/client/api';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { CardDrawer } from './CardDrawer';
import {
  CARD_CHANGED_EVENT,
  type CardTarget,
  cardTargetOf,
  OPEN_CARD_EVENT,
} from './cardPeekEvents';
import { namesAsOwners } from './owners';
import { useOptimisticCardSave } from './useOptimisticCardSave';

interface PeekBundle {
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  cards: BoardCardRow[];
  people?: PeopleNames;
  owners?: Assignable[];
  linkSummaries?: LinkSummary[];
  viewerEmail?: string;
}

interface Peek {
  target: CardTarget;
  href: string;
}

export function CardPeek() {
  // A stack: a linked card opened from inside a peek opens over it, so the
  // card underneath keeps any edit still waiting to save, and closing the
  // top one goes back to it.
  const [peeks, setPeeks] = useState<Peek[]>([]);
  const open = useRef(peeks);
  open.current = peeks;
  const changed = useRef(false);

  useEffect(() => {
    // Capture phase, so this runs before the ClientRouter's own link handler
    // (which skips a click whose default is already prevented). The link's
    // own onClick still runs — search closes, a notification marks read.
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) {
        return;
      }
      const target = cardTargetOf(link.href, window.location.origin);
      if (!target) return;
      event.preventDefault();
      const stack = open.current;
      if (stack.some((peek) => peek.target.id === target.id)) return;
      // With a peek up, the page underneath does not take the card.
      const claimed =
        stack.length === 0 &&
        !window.dispatchEvent(
          new CustomEvent<CardTarget>(OPEN_CARD_EVENT, { detail: target, cancelable: true })
        );
      if (claimed) return;
      if (stack.length === 0) changed.current = false;
      setPeeks([...stack, { target, href: link.href }]);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const closeTop = (id: string) => {
    const rest = open.current.filter((peek) => peek.target.id !== id);
    setPeeks(rest);
    if (rest.length === 0 && changed.current) window.dispatchEvent(new Event(CARD_CHANGED_EVENT));
  };

  return (
    <>
      {peeks.map((peek) => (
        <PeekDrawer
          key={peek.target.id}
          peek={peek}
          onChanged={() => {
            changed.current = true;
          }}
          onClose={() => closeTop(peek.target.id)}
          onUnavailable={() => {
            closeTop(peek.target.id);
            void navigate(peek.href);
          }}
        />
      ))}
    </>
  );
}

function PeekDrawer({
  peek,
  onChanged,
  onClose,
  onUnavailable,
}: {
  peek: Peek;
  onChanged: () => void;
  onClose: () => void;
  /** The card could not be loaded here: go where the link pointed instead. */
  onUnavailable: () => void;
}) {
  const [bundle, setBundle] = useState<PeekBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  useEffect(() => {
    let cancelled = false;
    const fallBack = () => {
      if (!cancelled) unavailable.current();
    };
    void fetch(`/api/admin/board-cards?board=${encodeURIComponent(peek.target.slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const next = (await res.json()) as PeekBundle;
        if (cancelled) return;
        if (!next.cards.some((card) => card.id === peek.target.id)) return fallBack();
        setBundle(next);
      })
      .catch(fallBack);
    return () => {
      cancelled = true;
    };
  }, [peek]);

  const save = useOptimisticCardSave(bundle, setBundle);
  const links = useMemo(() => summariesById(bundle?.linkSummaries), [bundle?.linkSummaries]);

  const card = bundle?.cards.find((row) => row.id === peek.target.id) ?? null;
  if (!bundle || !card) {
    return (
      <p
        role="status"
        className="fixed right-4 bottom-4 z-50 rounded border border-white/15 bg-[var(--pyre-black)] px-3 py-2 font-mono text-xs text-white/60 shadow-xl"
      >
        Opening…
      </p>
    );
  }

  const people = bundle.people ?? {};
  const owners = bundle.owners?.length ? bundle.owners : namesAsOwners(people);

  return (
    <CardDrawer
      card={card}
      columns={bundle.columns}
      fields={bundle.fields}
      people={people}
      owners={owners}
      links={links}
      onLinkPicked={(summary) =>
        setBundle((prev) =>
          prev
            ? {
                ...prev,
                linkSummaries: [
                  ...(prev.linkSummaries ?? []).filter((entry) => entry.id !== summary.id),
                  summary,
                ],
              }
            : prev
        )
      }
      viewerEmail={bundle.viewerEmail}
      busy={busy}
      onClose={onClose}
      onSave={async (patch) => {
        await save(card.id, patch);
        onChanged();
      }}
      onDelete={async () => {
        setBusy(true);
        try {
          await sendJson(`/api/admin/board-cards?id=${card.id}`, 'DELETE');
          onChanged();
          onClose();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}
