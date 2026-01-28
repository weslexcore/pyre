// BookButton component
// Smart booking button that handles auth state and credits

import { useCallback, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBookSession } from '@/hooks/useBookSession';
import { useMemberCredits } from '@/hooks/useMemberCredits';

interface BookButtonProps {
  eventId: string | number;
  eventTitle: string;
  momenceLink: string;
  isFull?: boolean;
  className?: string;
}

export function BookButton({
  eventId,
  eventTitle: _eventTitle, // Reserved for future analytics/tracking
  momenceLink,
  isFull = false,
  className = '',
}: BookButtonProps) {
  const { isAuthenticated, loading: authLoading, login } = useAuth();
  const { hasCredits, loading: creditsLoading } = useMemberCredits();
  const { book, loading: bookingLoading } = useBookSession();
  const [bookingState, setBookingState] = useState<'idle' | 'success' | 'error' | 'waitlisted'>(
    'idle'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLoginClick = useCallback(() => {
    login({ returnUrl: `/events` });
  }, [login]);

  const handleBookClick = useCallback(async () => {
    if (!isAuthenticated) {
      handleLoginClick();
      return;
    }

    setBookingState('idle');
    setErrorMessage(null);

    const result = await book(Number(eventId));

    if (result.success) {
      if (result.waitlisted) {
        setBookingState('waitlisted');
      } else {
        setBookingState('success');
      }
    } else {
      setBookingState('error');
      setErrorMessage(result.message || 'Booking failed');

      // If no credits, redirect to Momence for payment
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    }
  }, [isAuthenticated, handleLoginClick, book, eventId]);

  // Loading states
  if (authLoading) {
    return (
      <div
        className={`h-10 px-4 rounded-md bg-[var(--pyre-red)]/50 animate-pulse ${className}`}
        aria-hidden="true"
      />
    );
  }

  // Not authenticated - show login button
  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={handleLoginClick}
        className={`inline-flex items-center justify-center px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity ${className}`}
      >
        Login to Book
      </button>
    );
  }

  // Success states
  if (bookingState === 'success') {
    return (
      <div
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-green-600 text-white ${className}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Booked!
      </div>
    );
  }

  if (bookingState === 'waitlisted') {
    return (
      <div
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-blue)] text-[var(--pyre-creme)] ${className}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Waitlisted
      </div>
    );
  }

  // Error state with retry
  if (bookingState === 'error' && errorMessage) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-[var(--pyre-red)]">{errorMessage}</p>
        <button
          type="button"
          onClick={handleBookClick}
          className={`inline-flex items-center justify-center px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide border border-[var(--pyre-red)] text-[var(--pyre-red)] hover:bg-[var(--pyre-red)] hover:text-[var(--pyre-creme)] transition-colors ${className}`}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Loading credits
  if (creditsLoading) {
    return (
      <div
        className={`h-10 px-4 rounded-md bg-[var(--pyre-red)]/50 animate-pulse ${className}`}
        aria-hidden="true"
      />
    );
  }

  // Has credits - can book directly
  if (hasCredits) {
    const buttonLabel = isFull ? 'Join Waitlist' : 'Book Now';

    return (
      <button
        type="button"
        onClick={handleBookClick}
        disabled={bookingLoading}
        className={`inline-flex items-center justify-center px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 disabled:opacity-50 transition-opacity ${className}`}
      >
        {bookingLoading ? (
          <>
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Booking...
          </>
        ) : (
          buttonLabel
        )}
      </button>
    );
  }

  // No credits - link to Momence for payment
  const buttonLabel = isFull ? 'Join Waitlist' : 'Purchase & Book';

  return (
    <a
      href={momenceLink}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center px-4 py-2 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity ${className}`}
    >
      {buttonLabel}
      <svg className="ml-1 w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
        />
      </svg>
    </a>
  );
}
