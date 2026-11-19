// Runs once, before every device project: seeds the staff roster (roles.ts)
// in the e2e stack and signs each role in through the app's real password
// route, saving the session cookies for specs to reuse with
// `test.use({ storageState: ADMIN.storageState })`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { request as playwrightRequest, test as setup } from '@playwright/test';
import { ensureAuthUser, expect, supabaseAdmin, supabaseSessionCookies } from '@pyre/e2e-utils';
import { SESSION_COOKIE } from '../src/lib/supabase/server';
import { APP_URL, SUPABASE } from './env';
import { LIVE_TEMPLATES, PARTNER, PARTNER_OFF, REFERRAL_TIER } from './partners';
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
      is_shift_lead: role.isShiftLead ?? false,
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

  // Settings the app caches for ~30s, so they are set before any spec runs.
  // Guest profiles are off by default, which sends most guest pages to
  // Check Ins; the schedule's request toggles are on by default, kept on here.
  const settings = await db
    .from('app_settings')
    .upsert({ key: 'guests.profiles', value: true, updated_by: 'e2e' }, { onConflict: 'key' });
  expect(settings.error, 'guests.profiles setting').toBeNull();
  const toggles = await db.from('schedule_settings').upsert(
    ['shift_requests', 'sub_requests', 'hours_changes'].map((key) => ({
      key,
      enabled: true,
      updated_by: 'e2e',
    })),
    { onConflict: 'key' }
  );
  expect(toggles.error, 'schedule request toggles').toBeNull();

  // Partners, the referral tier and the template gate are cached ~30s too.
  // Reconciliation stays off: its quarterly email would go out on every
  // non-dry-run tick a spec makes.
  const partners = await db.from('partners').upsert(
    [PARTNER, PARTNER_OFF].map((partner) => ({
      slug: partner.slug,
      name: partner.name,
      tag_name: partner.tagName,
      discount_percent: partner.discountPercent,
      contact_emails: [partner.contact],
      enabled: partner === PARTNER,
      reconciliation_enabled: false,
      updated_by: 'e2e',
    })),
    { onConflict: 'slug' }
  );
  expect(partners.error, 'partners').toBeNull();
  const tier = await db
    .from('referral_tiers')
    .upsert({ percent: REFERRAL_TIER.percent, tag_name: REFERRAL_TIER.tagName });
  expect(tier.error, 'referral tier').toBeNull();
  const templates = await db.from('email_template_overrides').upsert(
    LIVE_TEMPLATES.map((template) => ({ template, live: true, updated_by: 'e2e' })),
    { onConflict: 'template' }
  );
  expect(templates.error, 'live templates').toBeNull();

  for (const role of ROLES) {
    if (!role.storageState) continue;
    mkdirSync(dirname(role.storageState), { recursive: true });
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
