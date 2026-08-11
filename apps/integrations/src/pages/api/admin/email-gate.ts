// Delivery-gate management for /admin/email-templates: GET returns the
// effective gate (env baseline + Supabase overrides), POST flips a template
// live/gated, returns it to env control, or adds/removes a dashboard-managed
// whitelist address. Env whitelist entries are read-only here — they can only
// change with the env var.

import type { APIRoute } from 'astro';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailTemplateKey } from '@/emails/types';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  addWhitelistEmail,
  getEmailGate,
  removeWhitelistEmail,
  setTemplateOverride,
} from '@/lib/email/dev-mode';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && value in EMAIL_TEMPLATES;
}

async function gateSnapshot(): Promise<Record<string, unknown>> {
  const gate = await getEmailGate();
  return {
    templates: Object.keys(EMAIL_TEMPLATES).map((key) => ({
      key,
      live: gate.isLive(key),
      source: key in gate.overrides ? 'db' : 'env',
    })),
    whitelist: gate.whitelist,
    dbAvailable: gate.dbAvailable,
  };
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/email-templates');
  if (gate instanceof Response) return gate;
  return json(await gateSnapshot());
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/email-templates');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action, template, live, email } = (body ?? {}) as {
    action?: unknown;
    template?: unknown;
    live?: unknown;
    email?: unknown;
  };
  const actor = gate.user.email ?? null;

  if (action === 'set-template') {
    if (!isTemplateKey(template)) {
      return json({ error: `Unknown template: ${String(template)}` }, 400);
    }
    if (typeof live !== 'boolean' && live !== null) {
      return json({ error: 'live must be a boolean or null (null = use env)' }, 400);
    }
    const { error } = await setTemplateOverride(template, live, actor);
    if (error) return json({ error }, 503);
    return json(await gateSnapshot());
  }

  if (action === 'add-whitelist' || action === 'remove-whitelist') {
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(address)) {
      return json({ error: 'email must be a valid address' }, 400);
    }
    if (action === 'remove-whitelist') {
      // Env entries have no row to delete; the UI never offers removal for
      // them, and deleting a nonexistent row is a harmless no-op anyway.
      const { error } = await removeWhitelistEmail(address);
      if (error) return json({ error }, 503);
    } else {
      const { error } = await addWhitelistEmail(address, actor);
      if (error) return json({ error }, 503);
    }
    return json(await gateSnapshot());
  }

  return json({ error: 'Unknown action' }, 400);
};
