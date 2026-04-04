// Member profile update API endpoint
// PATCH - Update profile fields (currently only phone)

import type { APIRoute } from 'astro';
import { getValidAccessToken } from '@/lib/auth-session';
import type { UpdateProfileRequest, UpdateProfileResponse } from '@/lib/momence-oauth-types';

export const prerender = false;

const MOMENCE_API_BASE = 'https://api.momence.com/api/v2';

// Phone validation: 7-20 digits, allowing common formatting characters
const PHONE_REGEX = /^[\d\s\-().+]{7,20}$/;
const DIGITS_ONLY_REGEX = /\d/g;

function validatePhone(phone: string): boolean {
  if (!phone || phone.trim() === '') return true; // Empty is valid (clearing phone)

  // Check format
  if (!PHONE_REGEX.test(phone)) return false;

  // Must have at least 7 digits
  const digits = phone.match(DIGITS_ONLY_REGEX);
  return digits !== null && digits.length >= 7 && digits.length <= 15;
}

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const accessToken = await getValidAccessToken(cookies);

  if (!accessToken) {
    const response: UpdateProfileResponse = {
      success: false,
      error: 'not_authenticated',
    };
    return new Response(JSON.stringify(response), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: UpdateProfileRequest;
  try {
    body = await request.json();
  } catch {
    const response: UpdateProfileResponse = {
      success: false,
      error: 'Invalid request body',
    };
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate phone if provided
  if (body.phone !== undefined && !validatePhone(body.phone)) {
    const response: UpdateProfileResponse = {
      success: false,
      error: 'invalid_phone',
    };
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Attempt to update via Momence API
    const updateResponse = await fetch(`${MOMENCE_API_BASE}/member/profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        phone: body.phone,
      }),
    });

    if (updateResponse.ok) {
      const data = await updateResponse.json();
      const response: UpdateProfileResponse = {
        success: true,
        user: data.user || data,
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If 404 or 405, the endpoint doesn't exist - fall back to localStorage
    if (updateResponse.status === 404 || updateResponse.status === 405) {
      console.log(
        '[Profile API] Momence API does not support profile updates, using localStorage fallback'
      );
      const response: UpdateProfileResponse = {
        success: true,
        useLocalStorage: true,
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Other error from Momence API
    console.error('[Profile API] Momence API error:', updateResponse.status);
    const response: UpdateProfileResponse = {
      success: false,
      error: 'update_failed',
    };
    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Profile API] Error:', error);

    // Network error or similar - fall back to localStorage
    const response: UpdateProfileResponse = {
      success: true,
      useLocalStorage: true,
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
