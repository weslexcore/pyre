// Member memberships API endpoint
// GET user's active memberships and credits from Momence (single call)

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type {
  MemberCredits,
  MemberMembership,
  MomenceBoughtMembershipPayload,
  MomenceBoughtMembershipsResponse,
} from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const GET: APIRoute = async ({ cookies }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: 'not_authenticated',
        memberships: [],
        credits: null,
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const response = await fetch(
      `${MOMENCE_API_BASE}/member/bought-memberships/active?page=0&pageSize=200&includeFrozen=true`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'not_authenticated', memberships: [], credits: null }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      console.warn('[Member Memberships API] Momence returned:', response.status);
      return new Response(JSON.stringify({ memberships: [], credits: null, total: 0 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-cache',
        },
      });
    }

    const data: MomenceBoughtMembershipsResponse = await response.json();
    const payload = data.payload || [];

    // Transform Momence response to our format
    const memberships: MemberMembership[] = payload.map((m: MomenceBoughtMembershipPayload) => {
      const creditsInfo = buildCredits(m);
      return {
        id: m.id,
        name: m.membership.name,
        description: m.membership.description,
        status: mapStatus(m),
        startDate: m.startDate,
        endDate: m.endDate ?? undefined,
        autoRenew: m.membership.autoRenewing,
        credits: creditsInfo,
      };
    });

    // Filter to only active memberships
    const activeMemberships = memberships.filter(
      (m) => m.status === 'active' || m.status === 'paused'
    );

    // Compute aggregated credits across all active memberships
    const credits = computeAggregatedCredits(payload, activeMemberships);

    return new Response(
      JSON.stringify({
        memberships: activeMemberships,
        credits,
        total: activeMemberships.length,
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
    console.error('[Member Memberships API] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        memberships: [],
        credits: null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

function mapStatus(m: MomenceBoughtMembershipPayload): MemberMembership['status'] {
  if (m.isFrozen) return 'paused';
  if (m.endDate && new Date(m.endDate) < new Date()) return 'expired';
  return 'active';
}

function buildCredits(m: MomenceBoughtMembershipPayload): MemberMembership['credits'] {
  // Event credits (per-event tracking)
  if (m.eventCreditsTotal !== null && m.eventCreditsTotal !== undefined) {
    const total = m.eventCreditsTotal;
    const remaining = m.eventCreditsLeft ?? 0;
    return {
      total,
      used: total - remaining,
      remaining,
      unlimited: false,
    };
  }

  // Combined usage limit (aggregate tracking)
  if (m.combinedUsageLimit !== null && m.combinedUsageLimit !== undefined) {
    const total = m.combinedUsageLimit;
    const used = m.combinedUsage ?? 0;
    return {
      total,
      used,
      remaining: total - used,
      unlimited: false,
    };
  }

  // No credit limits = unlimited subscription
  return {
    total: 0,
    used: 0,
    remaining: 0,
    unlimited: true,
  };
}

function computeAggregatedCredits(
  payload: MomenceBoughtMembershipPayload[],
  activeMemberships: MemberMembership[]
): MemberCredits | null {
  if (activeMemberships.length === 0) return null;

  let totalCredits = 0;
  let hasUnlimited = false;
  let source: string | undefined;
  let expiresAt: string | undefined;

  for (const m of payload) {
    // Only count non-frozen, non-expired memberships
    const status = mapStatus(m);
    if (status !== 'active') continue;

    // Check for unlimited
    if (m.eventCreditsTotal === null && m.combinedUsageLimit === null) {
      hasUnlimited = true;
      source = m.membership.name;
      break;
    }

    // Sum event credits
    if (m.eventCreditsLeft !== null && m.eventCreditsLeft !== undefined) {
      totalCredits += m.eventCreditsLeft;
      if (!source) {
        source = m.membership.name;
        expiresAt = m.endDate ?? undefined;
      }
    }

    // Sum combined usage remaining
    if (m.combinedUsageLimit !== null && m.combinedUsageLimit !== undefined) {
      const remaining = m.combinedUsageLimit - (m.combinedUsage ?? 0);
      if (remaining > 0) {
        totalCredits += remaining;
        if (!source) {
          source = m.membership.name;
          expiresAt = m.endDate ?? undefined;
        }
      }
    }
  }

  return {
    available: totalCredits,
    unlimited: hasUnlimited,
    source,
    expiresAt,
  };
}
