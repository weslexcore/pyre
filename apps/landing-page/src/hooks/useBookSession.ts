// React hook for booking sessions

import { useCallback, useState } from 'react';
import type { BookSessionResponse } from '@/lib/momence-member-types';

interface UseBookSessionResult {
  book: (eventId: number) => Promise<BookSessionResponse>;
  loading: boolean;
  error: string | null;
  lastResult: BookSessionResponse | null;
}

export function useBookSession(): UseBookSessionResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<BookSessionResponse | null>(null);

  const book = useCallback(async (eventId: number): Promise<BookSessionResponse> => {
    setLoading(true);
    setError(null);
    setLastResult(null);

    try {
      const response = await fetch('/api/member/book', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ eventId, useCredits: true }),
      });

      const data: BookSessionResponse = await response.json();
      setLastResult(data);

      if (!data.success) {
        setError(data.message || 'Booking failed');
      }

      return data;
    } catch (err) {
      console.error('[useBookSession] Error:', err);
      const errorResult: BookSessionResponse = {
        success: false,
        message: err instanceof Error ? err.message : 'Booking failed',
      };
      setError(errorResult.message || 'Booking failed');
      setLastResult(errorResult);
      return errorResult;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    book,
    loading,
    error,
    lastResult,
  };
}
