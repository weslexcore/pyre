// Runs once, before every device project: seeds the staff roster (roles.ts)
// in the e2e stack and signs each role in through the app's real password
// route, saving the session cookies for specs to reuse with
// `test.use({ storageState: ADMIN.storageState })`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { request as playwrightRequest, test as setup } from '@playwright/test';
import { ensureAuthUser, expect, supabaseAdmin, supabaseSessionCookies } from '@pyre/e2e-utils';
import { SESSION_COOKIE } from '../src/lib/supabase/server';
import { APP_URL, SUPABASE } from './env';
import { PASSWORD, ROLES } from './roles';

setup('seed the staff roster and sign each role in', async () => {
  const db = supabaseAdmin(SUPABASE);

  for (const role of ROLES) {
    const userId = await ensureAuthUser(db, {
      email: role.email,
      password: PASSWORD,
      displayName: role.displayName,
    });
    const row = {
      email: role.email,
      display_name: role.displayName,
      is_admin: role.isAdmin,
      pages: role.pages,
      active: true,
      user_id: userId,
    };
    const { data: existing, error: readError } = await db
      .from('staff')
      .select('id')
      .eq('email', role.email)
      .maybeSingle();
    expect(readError).toBeNull();
    const { error } = existing
      ? await db.from('staff').update(row).eq('id', existing.id)
      : await db.from('staff').insert(row);
    expect(error, `staff row for ${role.email}`).toBeNull();
  }

  mkdirSync('e2e/.auth', { recursive: true });
  for (const role of ROLES) {
    if (!role.storageState) continue;
    const context = await playwrightRequest.newContext({ baseURL: APP_URL });
    if (role.isAdmin || role.pages.length > 0) {
      const response = await context.post('/api/auth/password', {
        data: { email: role.email, password: PASSWORD },
      });
      expect(response.status(), `${role.email} signs in`).toBe(200);
      await context.storageState({ path: role.storageState });
    } else {
      // The app refuses to sign in someone without access (by design), so
      // write their Supabase session cookie directly: specs check what a
      // signed-in person without access sees.
      const cookies = await supabaseSessionCookies(
        SUPABASE,
        { email: role.email, password: PASSWORD },
        { cookieName: SESSION_COOKIE }
      );
      writeFileSync(role.storageState, JSON.stringify({ cookies, origins: [] }, null, 2));
    }
    await context.dispose();
  }
});
