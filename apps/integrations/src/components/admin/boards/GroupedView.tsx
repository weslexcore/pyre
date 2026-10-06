// A saved view of a board: the cards the search and owner filter leave,
// grouped the way the view says (lib/boards/views.ts). Read and open only —
// a card is changed in the drawer the board already has mounted, and moves
// between columns on the board itself. Dragging between groups would have to
// mean rewriting a date, a link, or one of several answers, and that is a
// decision a drop should not make.
//
// Two layouts: sections stacked down the page, for the many groups a month
// or a practitioner grouping makes, each folding shut; or lanes in the same
// grid as the columns, for a handful.

import { useMemo, useState } from 'react';
import type { LinkSummary } from '@/lib/boards/links';
import { groupCards } from '@/lib/boards/views';
import type { BoardCardRow, BoardColumnRow, BoardFieldRow, BoardViewRow } from '@/lib/db';
import type { PeopleNames } from '@/lib/sops/names';
import { cardClass } from '../goalsUi';
import { CardRow } from './CardRow';

/** Where a view's folded sections are remembered, on this device only. */
function foldKey(viewId: string): string {
  return `board-view-folded:${viewId}`;
}

function readFolded(viewId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(foldKey(viewId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(viewId: string, folded: Set<string>) {
  try {
    window.localStorage.setItem(foldKey(viewId), JSON.stringify([...folded]));
  } catch {
    // A private window or blocked storage: the fold lasts until the page goes.
  }
}

export function GroupedView({
  view,
  cards,
  columns,
  fields,
  people,
  links,
  today,
  viewerEmail,
  noun,
  onOpenCard,
}: {
  view: BoardViewRow;
  /** Already narrowed by the board's search and owner filter. */
  cards: BoardCardRow[];
  columns: BoardColumnRow[];
  fields: BoardFieldRow[];
  people: PeopleNames;
  links: Map<string, LinkSummary>;
  today: string;
  viewerEmail?: string;
  noun: string;
  onOpenCard: (id: string) => void;
}) {
  const result = useMemo(
    () => groupCards(view, { cards, columns, fields, people, links, viewerEmail }),
    [view, cards, columns, fields, people, links, viewerEmail]
  );
  const [folded, setFolded] = useState<Set<string>>(() =>
    typeof window === 'undefined' ? new Set() : readFolded(view.id)
  );

  if (!result.ok) {
    return (
      <p className={`${cardClass} text-sm text-white/50`}>
        This view groups by a field the board no longer has. Edit the view to pick another.
      </p>
    );
  }
  if (result.groups.length === 0) {
    return (
      <p className={`${cardClass} text-sm text-white/40`}>
        No {noun}s to show{view.hide_finished ? ' — finished ones are hidden in this view' : ''}.
      </p>
    );
  }

  const toggle = (key: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeFolded(view.id, next);
      return next;
    });

  const rows = (list: BoardCardRow[]) =>
    list.length === 0 ? (
      <p className="font-mono text-xs text-white/30">Nothing here.</p>
    ) : (
      list.map((card) => (
        <CardRow
          key={card.id}
          card={card}
          columns={columns}
          people={people}
          today={today}
          fields={fields}
          links={links}
          onOpen={(next) => onOpenCard(next.id)}
        />
      ))
    );

  if (view.layout === 'lanes') {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.groups.map((group) => (
          <section key={group.key} className={`${cardClass} min-w-0`}>
            <div className="mb-3 flex">
              <GroupHeading
                label={group.label}
                sublabel={group.sublabel}
                count={group.cards.length}
              />
            </div>
            <div className="space-y-2">{rows(group.cards)}</div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {result.groups.map((group) => {
        const open = !folded.has(group.key);
        const panelId = `view-group-${view.id}-${group.key}`;
        return (
          <section key={group.key} className={cardClass}>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(group.key)}
            >
              <span
                aria-hidden="true"
                className={`inline-block text-xs text-white/40 transition-transform ${open ? 'rotate-90' : ''}`}
              >
                ▸
              </span>
              <GroupHeading
                label={group.label}
                sublabel={group.sublabel}
                count={group.cards.length}
              />
            </button>
            {open && (
              <div id={panelId} className="mt-3 space-y-2">
                {rows(group.cards)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GroupHeading({
  label,
  sublabel,
  count,
}: {
  label: string;
  sublabel?: string;
  count: number;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      <span className="truncate font-primary-semibold text-sm text-[var(--pyre-creme)]">
        {label}
      </span>
      <span className="font-mono text-xs text-white/40">{count}</span>
      {sublabel && <span className="w-full truncate text-xs text-white/35">{sublabel}</span>}
    </span>
  );
}
