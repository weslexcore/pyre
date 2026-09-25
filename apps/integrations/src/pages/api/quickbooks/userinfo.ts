// Step 3b sample call: OpenID Connect userinfo for the Intuit account that
// granted consent (requires the openid/profile/email scopes).

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { getUserInfo, toErrorResponse } from '@/lib/quickbooks/client';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  try {
    const userInfo = await getUserInfo();
    return json(userInfo);
  } catch (error) {
    return toErrorResponse(error);
  }
};
