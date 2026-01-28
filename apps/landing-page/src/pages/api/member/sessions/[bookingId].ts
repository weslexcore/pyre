// Cancel booking API endpoint
// DELETE cancels a specific booking

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const { bookingId } = params;

  if (!bookingId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'missing_booking_id',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'not_authenticated',
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const response = await fetch(`${MOMENCE_API_BASE}/member-sessions/${bookingId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Cancel Booking API] Momence returned:', response.status, errorData);

      return new Response(
        JSON.stringify({
          success: false,
          error: errorData.message || 'cancel_failed',
          message: getCancelErrorMessage(response.status, errorData),
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const data = await response.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Booking cancelled successfully',
        creditsRefunded: data.creditsRefunded || 0,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Cancel Booking API] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'server_error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

function getCancelErrorMessage(status: number, data: any): string {
  if (data.message) return data.message;

  switch (status) {
    case 400:
      return 'This booking cannot be cancelled.';
    case 403:
      return 'Cancellation deadline has passed.';
    case 404:
      return 'Booking not found.';
    default:
      return 'Failed to cancel booking. Please try again.';
  }
}
