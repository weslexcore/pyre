import type { APIRoute } from 'astro';
import booking from '../lib/booking';

export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const bookingUrl = new URL(booking.bookingBaseUrl);

  // Add UTM source if not already present
  if (!bookingUrl.searchParams.has('utm_source')) {
    bookingUrl.searchParams.set('utm_source', booking.utmSource);
  }

  // Preserve any existing query parameters from the request
  url.searchParams.forEach((value, key) => {
    if (!bookingUrl.searchParams.has(key)) {
      bookingUrl.searchParams.set(key, value);
    }
  });

  // Return 302 temporary redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: bookingUrl.toString(),
    },
  });
};

export const prerender = false;
