// App settings (/admin/settings): feature switches and choices admins change
// here instead of in environment variables. Admin-only — these change what
// the whole app does. Definitions live in lib/settings/registry; values in the
// app_settings table (lib/settings/store).
//
//   GET                          → { settings: SettingView[] }
//   PUT { key, value }           → { settings }   (save)
//   DELETE ?key=<key>            → { settings }   (back to env/default)
//
// Mutations are CSRF-guarded in-route via assertSameOrigin.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { isSettingKey, parseSettingValue, SETTINGS } from '@/lib/settings/registry';
import { getAllSettings, resetSetting, saveSetting } from '@/lib/settings/store';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  return json({ settings: await getAllSettings() });
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!isSettingKey(body.key)) {
    return json({ error: `key must be one of: ${Object.keys(SETTINGS).join(', ')}` }, 400);
  }
  const parsed = parseSettingValue(body.key, body.value);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const by = (gate.user.email ?? '').trim().toLowerCase() || null;
  const { error } = await saveSetting(body.key, parsed.value, by);
  if (error) return json({ error }, 500);
  console.info(`[settings] ${by ?? 'unknown'} set ${body.key} = ${JSON.stringify(parsed.value)}`);
  return json({ settings: await getAllSettings() });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const key = url.searchParams.get('key');
  if (!isSettingKey(key)) return json({ error: 'Unknown setting' }, 400);
  const { error } = await resetSetting(key);
  if (error) return json({ error }, 500);
  console.info(`[settings] ${gate.user.email ?? 'unknown'} reset ${key}`);
  return json({ settings: await getAllSettings() });
};
