// Status colouring for lost-and-found items. Its own badge rather than the
// incident one: the statuses are different, and the tones say different things
// — gold means someone still has to do something, sage means it worked out,
// red means the 30 days are up.

import { type LostFoundStatus, statusLabel } from '@/lib/lost-found/types';

const badgeBase =
  'inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';

const STATUS_STYLES: Record<LostFoundStatus, string> = {
  unclaimed: 'border-white/25 text-white/60',
  claim_pending: 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]',
  claimed: 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]',
  picked_up: 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]',
  due_for_donation: 'border-[var(--pyre-red)]/60 text-[var(--pyre-red)]',
  donated: 'border-white/20 text-white/45',
  discarded: 'border-white/15 text-white/30 line-through',
};

export function LostFoundStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status as LostFoundStatus] ?? 'border-white/20 text-white/50';
  return <span className={`${badgeBase} bg-transparent ${style}`}>{statusLabel(status)}</span>;
}
