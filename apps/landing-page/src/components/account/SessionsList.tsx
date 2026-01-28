// SessionsList component
// Displays user's upcoming booked sessions with cancel functionality

import { useCallback, useState } from 'react';
import { useMemberSessions } from '@/hooks/useMemberSessions';
import { accountConfig } from '@/lib/account-config';
import type { MemberSession } from '@/lib/momence-member-types';

export function SessionsList() {
  const { sessions, loading, error, cancelSession, cancelling } = useMemberSessions();
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);

  const handleCancelClick = useCallback((bookingId: number) => {
    setConfirmCancel(bookingId);
  }, []);

  const handleConfirmCancel = useCallback(
    async (bookingId: number) => {
      const success = await cancelSession(bookingId);
      if (success) {
        setConfirmCancel(null);
      }
    },
    [cancelSession]
  );

  const handleCancelDismiss = useCallback(() => {
    setConfirmCancel(null);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-[var(--border)] animate-pulse"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  // Error state (ignore auth errors - handled at page level)
  if (error && error !== 'not_authenticated') {
    return (
      <div className="p-4 rounded-lg bg-[var(--pyre-red)]/10 text-[var(--pyre-red)] text-sm">
        Failed to load sessions. Please try again.
      </div>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <div>
        <p className="text-[var(--muted-foreground)]">{accountConfig.sessions.emptyState}</p>
        <a
          href="/events"
          className="inline-block mt-4 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-red)] hover:underline"
        >
          {accountConfig.sessions.emptyStateAction}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => (
        <SessionCard
          key={session.bookingId}
          session={session}
          onCancel={handleCancelClick}
          onConfirmCancel={handleConfirmCancel}
          onDismissCancel={handleCancelDismiss}
          isConfirming={confirmCancel === session.bookingId}
          isCancelling={cancelling === session.bookingId}
        />
      ))}
    </div>
  );
}

interface SessionCardProps {
  session: MemberSession;
  onCancel: (bookingId: number) => void;
  onConfirmCancel: (bookingId: number) => void;
  onDismissCancel: () => void;
  isConfirming: boolean;
  isCancelling: boolean;
}

function SessionCard({
  session,
  onCancel,
  onConfirmCancel,
  onDismissCancel,
  isConfirming,
  isCancelling,
}: SessionCardProps) {
  const date = new Date(session.dateTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--card)]">
      {/* Date badge */}
      <div className="flex-shrink-0 w-14 text-center">
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { weekday: 'short' })}
        </div>
        <div className="text-2xl font-primary-semibold">{date.getDate()}</div>
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { month: 'short' })}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <h3 className="font-primary-semibold text-lg truncate">{session.title}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          {formattedTime} • {session.location}
        </p>
        {session.teacherName && (
          <p className="text-sm text-[var(--muted-foreground)]">with {session.teacherName}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0">
        {isConfirming ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onConfirmCancel(session.bookingId)}
              disabled={isCancelling}
              className="px-3 py-1.5 text-xs font-mono-bold uppercase rounded bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isCancelling ? 'Cancelling...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={onDismissCancel}
              disabled={isCancelling}
              className="px-3 py-1.5 text-xs font-mono-bold uppercase rounded border border-[var(--border)] hover:bg-[var(--border)] disabled:opacity-50 transition-colors"
            >
              Keep
            </button>
          </div>
        ) : (
          session.canCancel && (
            <button
              type="button"
              onClick={() => onCancel(session.bookingId)}
              className="px-3 py-1.5 text-xs font-mono-bold uppercase rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--pyre-red)] hover:text-[var(--pyre-red)] transition-colors"
            >
              {accountConfig.sessions.cancelButton}
            </button>
          )
        )}
      </div>
    </div>
  );
}
