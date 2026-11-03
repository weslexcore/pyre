// Pyre's Google rating + review count for the GoogleRatingBadge component.
// Cached at the CDN for a day so the Places API is called about once a day.
import type { APIRoute } from 'astro';
import { getGoogleRating } from '@/lib/google-reviews';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const rating = await getGoogleRating();
    return new Response(JSON.stringify(rating), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': rating
          ? 'public, s-maxage=86400, stale-while-revalidate=604800'
          : 'public, s-maxage=300',
      },
    });
  } catch (error) {
    console.error('[Google Rating API] Error:', error);
    return new Response('null', {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, s-maxage=300' },
    });
  }
};
