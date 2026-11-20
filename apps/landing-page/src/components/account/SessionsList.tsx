// SessionsList component
// Displays user's upcoming booked sessions with cancel functionality

import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { type CancelError, useMemberSessions } from '@/hooks/useMemberSessions';
import { accountConfig } from '@/lib/account-config';
import type { MemberSession } from '@/lib/momence-member-types';

export function SessionsList() {
  const { sessions, loading, error, cancelSession, cancelling, cancelError } = useMemberSessions();
  const { login } = useAuth();
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const signInAgain = useCallback(() => login({ returnUrl: '/account' }), [login]);

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

  // The page thought we were signed in, but the member API says the sign-in
  // has expired: say so, rather than showing an empty list.
  if (error === 'not_authenticated') {
    return <SessionExpired onSignIn={signInAgain} />;
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 rounded-lg bg-[var(--pyre-red)]/10 text-[var(--pyre-red)] text-sm">
        Failed to load sessions. Please try again.
      </div>
    );
  }

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-[var(--pyre-creme)]/70">{accountConfig.sessions.emptyState}</p>
        <a
          href="/events"
          className="inline-flex items-center justify-center mt-4 px-6 py-2.5 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
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
          cancelError={cancelError?.bookingId === session.bookingId ? cancelError : null}
          onSignIn={signInAgain}
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
  cancelError: CancelError | null;
  onSignIn: () => void;
}

function SessionExpired({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div role="alert" className="text-center py-4">
      <p className="text-[var(--pyre-creme)]/70">{accountConfig.sessions.sessionExpired}</p>
      <button
        type="button"
        onClick={onSignIn}
        className="inline-flex items-center justify-center mt-4 px-6 py-2.5 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
      >
        {accountConfig.sessions.signInAgainButton}
      </button>
    </div>
  );
}

function SessionCard({
  session,
  onCancel,
  onConfirmCancel,
  onDismissCancel,
  isConfirming,
  isCancelling,
  cancelError,
  onSignIn,
}: SessionCardProps) {
  const date = new Date(session.dateTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });

  return (
    <div
      data-member-booking={session.bookingId}
      className="flex items-start gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--pyre-black)] text-[var(--pyre-creme)]"
    >
      {/* Date badge */}
      <div className="flex-shrink-0 w-14 text-center">
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })}
        </div>
        <div className="text-2xl font-primary-semibold">
          {date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/New_York' })}
        </div>
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' })}
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
        {cancelError && (
          <p role="alert" className="mt-2 text-sm text-[var(--pyre-red)]">
            {cancelError.reason === 'not_authenticated' ? (
              <>
                {accountConfig.sessions.sessionExpired}{' '}
                <button type="button" onClick={onSignIn} className="underline hover:no-underline">
                  {accountConfig.sessions.signInAgainButton}
                </button>
              </>
            ) : (
              (cancelError.message ?? accountConfig.sessions.cancelFailed)
            )}
          </p>
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
              className="px-3 py-1.5 text-xs font-mono-bold uppercase rounded border border-[var(--pyre-blue)] hover:bg-[var(--pyre-blue)] disabled:opacity-50 transition-colors"
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
