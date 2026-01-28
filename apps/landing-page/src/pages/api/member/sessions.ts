// Member sessions API endpoint
// GET user's booked sessions from Momence

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type { MemberSession } from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const GET: APIRoute = async ({ cookies }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: 'not_authenticated',
        sessions: [],
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  try {
    const response = await fetch(`${MOMENCE_API_BASE}/member-sessions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[Member Sessions API] Momence returned:', response.status);
      return new Response(
        JSON.stringify({
          error: 'fetch_failed',
          sessions: [],
        }),
        {
          status: response.status === 401 ? 401 : 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const data = await response.json();

    // Transform Momence response to our format
    const sessions: MemberSession[] = (data.sessions || data || []).map((s: any) => ({
      id: s.id,
      bookingId: s.bookingId || s.id,
      eventId: s.eventId,
      title: s.title || s.eventTitle,
      description: s.description,
      dateTime: s.dateTime || s.startTime,
      duration: s.duration,
      location: s.location || s.locationName,
      teacherName: s.teacherName || s.teacher,
      status: mapStatus(s.status),
      canCancel: s.canCancel !== false,
      cancelDeadline: s.cancelDeadline,
      image: s.image || s.image1,
      link: s.link,
    }));

    // Filter to only upcoming sessions
    const now = new Date();
    const upcomingSessions = sessions.filter((s) => {
      const sessionDate = new Date(s.dateTime);
      return sessionDate >= now && s.status !== 'cancelled';
    });

    // Sort by date ascending
    upcomingSessions.sort(
      (a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime()
    );

    return new Response(
      JSON.stringify({
        sessions: upcomingSessions,
        total: upcomingSessions.length,
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
    console.error('[Member Sessions API] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        sessions: [],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

function mapStatus(status: string): MemberSession['status'] {
  const statusMap: Record<string, MemberSession['status']> = {
    confirmed: 'confirmed',
    pending: 'pending',
    cancelled: 'cancelled',
    attended: 'attended',
    no_show: 'no_show',
    noshow: 'no_show',
  };
  return statusMap[status?.toLowerCase()] || 'confirmed';
}
