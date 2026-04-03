// Member credits API endpoint
// Credits are now served by /api/member/memberships — this endpoint
// only handles standalone credit-pack lookups as a fallback.

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type { MemberCredits } from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const GET: APIRoute = async ({ cookies }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: 'not_authenticated',
        credits: null,
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    let totalCredits = 0;
    let source: string | undefined;
    let expiresAt: string | undefined;

    // Only check standalone credit packs (membership credits come from /api/member/memberships)
    try {
      const packsResponse = await fetch(`${MOMENCE_API_BASE}/member/credit-packs`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (packsResponse.ok) {
        const packsData = await packsResponse.json();
        const packs = packsData.packs || packsData || [];

        for (const pack of packs) {
          if (pack.status === 'active' && pack.creditsRemaining > 0) {
            totalCredits += pack.creditsRemaining;
            if (!source) {
              source = pack.name || 'Credit Pack';
              expiresAt = pack.expiresAt;
            }
          }
        }
      }
    } catch {
      // Credit packs endpoint might not exist, that's okay
    }

    const credits: MemberCredits = {
      available: totalCredits,
      unlimited: false,
      source,
      expiresAt,
    };

    return new Response(JSON.stringify({ credits }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    console.error('[Member Credits API] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        credits: null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
