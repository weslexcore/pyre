// Member sessions API endpoint
// GET user's booked sessions from Momence

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type {
  MemberSession,
  MomenceBookingPayload,
  MomenceSessionsResponse,
} from '@/lib/momence-member-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

export const GET: APIRoute = async ({ cookies, url }) => {
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

  const type = url.searchParams.get('type') || 'upcoming';

  try {
    const response = await fetch(`${MOMENCE_API_BASE}/member/sessions?page=0&pageSize=50`, {
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

    const data: MomenceSessionsResponse = await response.json();

    // Transform Momence booking payloads to our internal format
    const sessions: MemberSession[] = (data.payload || []).map((booking: MomenceBookingPayload) => {
      const session = booking.session;
      const startsAt = new Date(session.startsAt);
      const isPast = startsAt < new Date();

      let status: MemberSession['status'];
      if (booking.cancelledAt) {
        status = 'cancelled';
      } else if (booking.checkedIn) {
        status = 'attended';
      } else if (isPast) {
        status = 'no_show';
      } else {
        status = 'confirmed';
      }

      const canCancel = !isPast && !booking.cancelledAt;

      return {
        id: session.id,
        bookingId: booking.id,
        eventId: session.id,
        title: session.name,
        description: session.description,
        dateTime: session.startsAt,
        duration: session.duration,
        location: session.inPersonLocation?.name || '',
        teacherName: session.teacherName,
        status,
        canCancel,
        image: session.image1,
        link: session.link,
      };
    });

    const now = new Date();
    let filtered: MemberSession[];

    if (type === 'attended') {
      // Past sessions (attended or missed), excluding cancelled
      filtered = sessions
        .filter((s) => {
          const sessionDate = new Date(s.dateTime);
          return sessionDate < now && s.status !== 'cancelled';
        })
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());
    } else {
      // Upcoming sessions, excluding cancelled
      filtered = sessions
        .filter((s) => {
          const sessionDate = new Date(s.dateTime);
          return sessionDate >= now && s.status !== 'cancelled';
        })
        .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
    }

    return new Response(
      JSON.stringify({
        sessions: filtered,
        total: filtered.length,
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
