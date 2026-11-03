// Server-side lookup of Pyre's Google rating and review count via the Google
// Places API (New). Called only from /api/google-rating, whose response is
// cached at the CDN, so Google is hit about once a day.
//
// Env:
//   GOOGLE_PLACES_API_KEY  (required) key with "Places API (New)" enabled
//   GOOGLE_PLACE_ID        (optional) Pyre's place id; without it the place is
//                          found by a text search on the business name + address
import location from './location';

export interface GoogleRating {
  rating: number;
  count: number;
  /** Link to the Google Maps listing, where the reviews live. */
  url: string;
}

const PLACES_API = 'https://places.googleapis.com/v1';
const FIELDS = ['rating', 'userRatingCount', 'googleMapsUri'];

interface PlaceResponse {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

function env(name: string): string | undefined {
  return (import.meta.env[name] as string | undefined) ?? process.env[name];
}

async function fetchPlace(
  apiKey: string,
  placeId: string | undefined
): Promise<PlaceResponse | null> {
  if (placeId) {
    const res = await fetch(`${PLACES_API}/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS.join(',') },
    });
    if (!res.ok) throw new Error(`Places details ${res.status}: ${await res.text()}`);
    return (await res.json()) as PlaceResponse;
  }

  const res = await fetch(`${PLACES_API}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELDS.map((f) => `places.${f}`).join(','),
    },
    body: JSON.stringify({ textQuery: `Pyre Sauna, ${location.address}`, pageSize: 1 }),
  });
  if (!res.ok) throw new Error(`Places search ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { places?: PlaceResponse[] };
  return data.places?.[0] ?? null;
}

/** Pyre's Google rating, or null when unconfigured, unavailable or unrated. */
export async function getGoogleRating(): Promise<GoogleRating | null> {
  const apiKey = env('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return null;

  const place = await fetchPlace(apiKey, env('GOOGLE_PLACE_ID'));
  if (!place?.rating || !place.userRatingCount || !place.googleMapsUri) return null;

  return {
    rating: Math.round(place.rating * 10) / 10,
    count: place.userRatingCount,
    url: place.googleMapsUri,
  };
}
