// Book session API endpoint
// POST to book an event using credits

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type { BookSessionResponse } from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const POST: APIRoute = async ({ request, cookies }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'not_authenticated',
      } satisfies BookSessionResponse),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  let body: { eventId: number; useCredits?: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'invalid_request',
        message: 'Invalid request body',
      } satisfies BookSessionResponse),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const { eventId, useCredits = true } = body;

  if (!eventId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'missing_event_id',
        message: 'Event ID is required',
      } satisfies BookSessionResponse),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const response = await fetch(`${MOMENCE_API_BASE}/member-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        eventId,
        useCredits,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[Book API] Momence returned:', response.status, data);

      // Check if it's a "no credits" error that needs payment
      if (response.status === 402 || data.requiresPayment) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'no_credits',
            message: 'No credits available. Purchase required.',
            checkoutUrl: data.checkoutUrl || data.paymentUrl,
          } satisfies BookSessionResponse),
          {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Check if event is full and user is waitlisted
      if (response.status === 200 && data.waitlisted) {
        return new Response(
          JSON.stringify({
            success: true,
            bookingId: data.bookingId || data.id,
            message: 'Added to waitlist',
            waitlisted: true,
          } satisfies BookSessionResponse),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: data.error || 'booking_failed',
          message: data.message || getBookingErrorMessage(response.status),
        } satisfies BookSessionResponse),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        bookingId: data.bookingId || data.id,
        message: 'Successfully booked!',
        waitlisted: data.waitlisted || false,
      } satisfies BookSessionResponse),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Book API] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'server_error',
        message: 'Failed to complete booking. Please try again.',
      } satisfies BookSessionResponse),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

function getBookingErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid booking request.';
    case 403:
      return 'This event is not available for booking.';
    case 404:
      return 'Event not found.';
    case 409:
      return 'You have already booked this event.';
    case 422:
      return 'Event is full.';
    default:
      return 'Failed to complete booking. Please try again.';
  }
}
