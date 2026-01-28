// Member credits API endpoint
// GET user's available credits/sessions for booking

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
    // First try to get credits from memberships
    const membershipResponse = await fetch(`${MOMENCE_API_BASE}/member/bought-memberships`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    let totalCredits = 0;
    let hasUnlimited = false;
    let source: string | undefined;
    let expiresAt: string | undefined;

    if (membershipResponse.ok) {
      const membershipData = await membershipResponse.json();
      const memberships = membershipData.memberships || membershipData || [];

      // Sum up credits from all active memberships
      for (const m of memberships) {
        if (m.status === 'active' || m.status === 'Active') {
          if (m.credits?.unlimited || m.sessionsRemaining === -1 || m.unlimited) {
            hasUnlimited = true;
            source = m.name || m.membershipName;
            break;
          }

          const remaining =
            m.credits?.remaining ?? m.sessionsRemaining ?? m.creditsRemaining ?? 0;
          if (remaining > 0) {
            totalCredits += remaining;
            // Use the first membership with credits as the source
            if (!source) {
              source = m.name || m.membershipName;
              expiresAt = m.endDate || m.expirationDate;
            }
          }
        }
      }
    }

    // If no membership credits, try to get credit packs
    if (totalCredits === 0 && !hasUnlimited) {
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
    }

    const credits: MemberCredits = {
      available: totalCredits,
      unlimited: hasUnlimited,
      source,
      expiresAt,
    };

    return new Response(
      JSON.stringify({
        credits,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-cache',
        },
      }
    );
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
