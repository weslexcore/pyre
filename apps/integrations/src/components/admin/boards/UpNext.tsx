// The top of /admin/boards: the viewer's next few dated cards across every
// board they hold, soonest first, so "what is mine and when" is answered
// before the boards are. A row that scrolls sideways rather than a list, so
// it costs one line of the page whatever it holds. Each card opens on its
// own board, drawer and all (#card-<id>, useCardDeepLink). A vertical rule
// marks where this week (Monday to Sunday, as "Due this week" counts it)
// ends and later weeks begin.

import { addDays, weekStartOf } from '@pyre/schedule-core';
import { Fragment } from 'react';
import { describeRepeat, repeatRuleOf } from '@/lib/boards/recurrence';
import type { UpNextCard } from '@/lib/boards/store';
import { DueChip, QuietChip } from '../goalsUi';

export function UpNext({ cards, today }: { cards: UpNextCard[]; today: string }) {
  const weekEnd = addDays(weekStartOf(today), 6);
  // Cards arrive soonest first, so the rule sits before the first one past Sunday.
  const firstLater = cards.findIndex((card) => card.due_date > weekEnd);
  return (
    <section aria-labelledby="up-next-title">
      <h2
        id="up-next-title"
        className="mb-2 font-mono text-xs uppercase tracking-wide text-white/50"
      >
        Up next for you
      </h2>
      {cards.length === 0 ? (
        <p className="font-mono text-xs text-white/35">Nothing with a due date is on you.</p>
      ) : (
        <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {cards.map((card, index) => {
            const repeat = repeatRuleOf(card);
            return (
              <Fragment key={card.id}>
                {index === firstLater && (
                  <li className="flex shrink-0 items-stretch gap-1.5 px-1">
                    <span aria-hidden="true" className="w-px bg-white/25" />
                    <span className="font-mono text-[10px] uppercase tracking-wide text-white/40 [writing-mode:vertical-rl] rotate-180 self-center">
                      <span className="sr-only">Due </span>After this week
                    </span>
                  </li>
                )}
                <li className="w-60 shrink-0 snap-start">
                  <a
                    href={`/admin/boards/${card.board_slug}#card-${card.id}`}
                    className="flex h-full flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
                  >
                    <span className="line-clamp-2 text-sm text-[var(--pyre-creme)]">
                      {card.title}
                    </span>
                    <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5">
                      <DueChip
                        dueDate={card.due_date}
                        today={today}
                        repeat={repeat ? describeRepeat(repeat) : null}
                      />
                      <QuietChip className="max-w-full overflow-hidden text-ellipsis">
                        {card.board_name}
                      </QuietChip>
                    </span>
                  </a>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}
