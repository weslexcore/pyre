import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ params, request }) => {
  const url = new URL(request.url);

  // Extract slug segments (can be empty, single, or multiple segments)
  const slug = params.slug || '';

  // Construct the Sweatpals event URL
  const sweatpalsEventUrl = new URL(`https://sweatpals.com/event/${slug}`);

  // Preserve all query parameters from the request
  url.searchParams.forEach((value, key) => {
    sweatpalsEventUrl.searchParams.set(key, value);
  });

  // Return 302 temporary redirect
  return new Response(null, {
    status: 302,
    headers: {
      Location: sweatpalsEventUrl.toString(),
    },
  });
};

export const prerender = false;
