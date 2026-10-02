// The top of /admin/boards: the viewer's next few dated cards across every
// board they hold, soonest first, so "what is mine and when" is answered
// before the boards are. A row that scrolls sideways rather than a list, so
// it costs one line of the page whatever it holds. Each card opens on its
// own board, drawer and all (#card-<id>, useCardDeepLink).

import { describeRepeat, repeatRuleOf } from '@/lib/boards/recurrence';
import type { UpNextCard } from '@/lib/boards/store';
import { DueChip, QuietChip } from '../goalsUi';

export function UpNext({ cards, today }: { cards: UpNextCard[]; today: string }) {
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
          {cards.map((card) => {
            const repeat = repeatRuleOf(card);
            return (
              <li key={card.id} className="w-60 shrink-0 snap-start">
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
