// Member memberships API endpoint
// GET user's active memberships from Momence

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type { MemberMembership } from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const GET: APIRoute = async ({ cookies }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: 'not_authenticated',
        memberships: [],
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const response = await fetch(`${MOMENCE_API_BASE}/member/bought-memberships`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // 401 means token is invalid - propagate as auth error
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: 'not_authenticated', memberships: [] }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Other errors (404, 500, etc.) - treat as "no memberships"
      // This handles users who have never purchased a membership
      console.warn('[Member Memberships API] Momence returned:', response.status);
      return new Response(
        JSON.stringify({ memberships: [], total: 0 }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'private, no-cache',
          },
        }
      );
    }

    const data = await response.json();

    // Transform Momence response to our format
    const memberships: MemberMembership[] = (data.memberships || data || []).map((m: any) => ({
      id: m.id,
      name: m.name || m.membershipName,
      description: m.description,
      status: mapStatus(m.status),
      startDate: m.startDate || m.purchaseDate,
      endDate: m.endDate || m.expirationDate,
      renewalDate: m.renewalDate || m.nextBillingDate,
      autoRenew: m.autoRenew !== false,
      credits: m.credits
        ? {
            total: m.credits.total || 0,
            used: m.credits.used || 0,
            remaining: m.credits.remaining ?? m.credits.total - m.credits.used,
            unlimited: m.credits.unlimited === true,
          }
        : m.sessionsRemaining !== undefined
          ? {
              total: m.sessionsTotal || 0,
              used: (m.sessionsTotal || 0) - m.sessionsRemaining,
              remaining: m.sessionsRemaining,
              unlimited: m.sessionsRemaining === -1 || m.unlimited === true,
            }
          : undefined,
      benefits: m.benefits || m.features,
    }));

    // Filter to only active memberships
    const activeMemberships = memberships.filter(
      (m) => m.status === 'active' || m.status === 'paused'
    );

    return new Response(
      JSON.stringify({
        memberships: activeMemberships,
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
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

function mapStatus(status: string): MemberMembership['status'] {
  const statusMap: Record<string, MemberMembership['status']> = {
    active: 'active',
    paused: 'paused',
    cancelled: 'cancelled',
    expired: 'expired',
    canceled: 'cancelled',
  };
  return statusMap[status?.toLowerCase()] || 'active';
}
