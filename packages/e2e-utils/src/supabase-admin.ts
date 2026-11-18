// Seeding and inspection helpers for a suite running against the local
// Supabase stack (see supabase.ts). Playwright-free, so setup projects, mock
// servers and specs can all use them.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LocalSupabase } from './supabase';

/**
 * A service-role client for the e2e stack: bypasses RLS, for seeding rows a
 * test needs and checking what the app wrote.
 */
export function supabaseAdmin(stack: Pick<LocalSupabase, 'apiUrl' | 'serviceRoleKey'>): SupabaseClient {
  return createClient(stack.apiUrl, stack.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthUserInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * A confirmed Auth user with this email and password, created or updated in
 * place. Idempotent, so a locally reused stack keeps working across runs.
 * Returns the user's id.
 */
export async function ensureAuthUser(admin: SupabaseClient, input: AuthUserInput): Promise<string> {
  const attributes = {
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: input.displayName ? { display_name: input.displayName } : {},
  };
  const created = await admin.auth.admin.createUser(attributes);
  if (!created.error) return created.data.user.id;

  // Already there: find it and reset the password, so the run's password
  // always works.
  const existing = await findAuthUser(admin, input.email);
  if (!existing) throw new Error(`Could not create auth user ${input.email}: ${created.error.message}`);
  const updated = await admin.auth.admin.updateUserById(existing, attributes);
  if (updated.error) throw new Error(`Could not update auth user ${input.email}: ${updated.error.message}`);
  return existing;
}

/** The id of the Auth user with this email, or null. */
export async function findAuthUser(admin: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

export interface MailpitMessageDetail extends MailpitMessage {
  Text: string;
  HTML: string;
}

/**
 * Read the stack's mail catcher (Mailpit): sign-in links and codes that
 * Supabase Auth sends. Addresses are shared across a run's parallel tests, so
 * give each test its own address.
 */
export function mailpitClient(baseUrl: string) {
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) throw new Error(`Mailpit ${path} returned ${res.status}`);
    return (await res.json()) as T;
  };

  const messagesTo = async (address: string): Promise<MailpitMessage[]> => {
    const query = encodeURIComponent(`to:"${address}"`);
    const { messages } = await get<{ messages: MailpitMessage[] }>(`/api/v1/search?query=${query}`);
    return messages;
  };

  return {
    messagesTo,
    /**
     * The newest message to `address` that arrived after `since`, polling
     * until `timeoutMs`. Pass the time the test asked for the email, so an
     * older message from a previous run is never picked up.
     */
    async waitForMessage(
      address: string,
      { since = new Date(0), timeoutMs = 15_000 }: { since?: Date; timeoutMs?: number } = {}
    ): Promise<MailpitMessageDetail> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const fresh = (await messagesTo(address)).filter(
          (message) => new Date(message.Created).getTime() >= since.getTime() - 1_000
        );
        if (fresh.length > 0) return get<MailpitMessageDetail>(`/api/v1/message/${fresh[0].ID}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`No email to ${address} within ${timeoutMs}ms`);
    },
  };
}

/** Every http(s) link in an email's HTML, with entities decoded. */
export function emailLinks(message: Pick<MailpitMessageDetail, 'HTML'>): string[] {
  return [...message.HTML.matchAll(/href="([^"]+)"/g)]
    .map((match) => match[1].replace(/&amp;/g, '&'))
    .filter((href) => /^https?:\/\//.test(href));
}

export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
  expires: number;
}

/**
 * Sign in to Supabase Auth directly and return the session as the cookies an
 * @supabase/ssr app reads (`cookieName`, chunked the way the library chunks
 * it), ready for `context.addCookies()`. For a user the app's own sign-in
 * would refuse, e.g. to test what a signed-in person without access sees.
 * Prefer signing in through the app wherever it allows it.
 */
export async function supabaseSessionCookies(
  stack: Pick<LocalSupabase, 'apiUrl' | 'anonKey'>,
  credentials: { email: string; password: string },
  options: { cookieName: string; domain?: string }
): Promise<SessionCookie[]> {
  const { createServerClient } = await import('@supabase/ssr');
  const jar = new Map<string, string>();
  const client = createServerClient(stack.apiUrl, stack.anonKey, {
    cookieOptions: { name: options.cookieName },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) throw new Error(`Supabase sign-in for ${credentials.email} failed: ${error.message}`);

  return [...jar].map(([name, value]) => ({
    name,
    value,
    domain: options.domain ?? 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 3600,
  }));
}
