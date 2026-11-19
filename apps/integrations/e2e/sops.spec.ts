// SOPs: running a checklist, editing a document, and who may read or edit
// which one. Each test creates its own documents (createSop), so nothing
// depends on the SOPs the migrations seed.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import { ADMIN, type Role, SHIFT_LEAD, STAFF, STAFF_2 } from './roles';
import { CHECKLIST, CHECKLIST_ITEMS, type CreatedSop, createSop, uniqueSlug } from './sops-helpers';
import { expect, open, test } from './test';

test.describe('running a checklist', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('staff tick every item and the run completes', async ({ page, as, db }, testInfo) => {
    const admin = await as(ADMIN);
    const sop = await createSop(admin, { slug: uniqueSlug(testInfo, 'close') });

    await open(page, `/admin/sops/${sop.slug}`);
    await expect(page.getByRole('heading', { name: sop.title })).toBeVisible();
    for (const item of CHECKLIST_ITEMS) {
      await page.getByText(item, { exact: true }).click();
      await expect(page.getByRole('checkbox', { name: item })).toBeChecked();
    }
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const { data } = await db
          .from('sop_runs')
          .select('status, started_by, ended_by')
          .eq('sop_id', sop.id);
        return data;
      })
      .toEqual([{ status: 'completed', started_by: STAFF.email, ended_by: STAFF.email }]);
    const { count } = await db
      .from('sop_run_checks')
      .select('id', { count: 'exact', head: true })
      .eq('checked_by', STAFF.email)
      .in('item_text', CHECKLIST_ITEMS);
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

test.describe('the library', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('search finds what staff may read, and nothing else', async ({ page, as }, testInfo) => {
    const admin = await as(ADMIN);
    const tag = uniqueSlug(testInfo, 'lib');
    const visible = await createSop(admin, { slug: `${tag}-a`, title: `Opening ${tag}` });
    const hidden = await createSop(admin, {
      slug: `${tag}-b`,
      title: `Payroll ${tag}`,
      viewRoles: ['admin'],
    });

    await open(page, '/admin/sops');
    await page.getByRole('searchbox', { name: 'Search SOPs' }).fill(tag);
    await expect(page.getByRole('link', { name: new RegExp(visible.title) }).first()).toBeVisible();
    await expect(page.getByText(hidden.title)).toHaveCount(0);
  });
});

test.describe('the runs API', { tag: DESKTOP_ONLY_TAG }, () => {
  let sop: CreatedSop;

  test.beforeEach(async ({ as }, testInfo) => {
    sop = await createSop(await as(ADMIN), { slug: uniqueSlug(testInfo, 'run') });
  });

  const start = (items: { itemIndex: number; skipped?: boolean }[]) => ({
    data: { sopId: sop.id, initialChecks: items },
  });

  test('a second person joins the run already open', async ({ as }) => {
    const first = await (await as(STAFF)).post('/api/admin/sop-runs', start([{ itemIndex: 0 }]));
    expect(first.status()).toBe(201);
    const { run } = (await first.json()) as { run: { id: string } };

    const second = await (await as(STAFF_2)).post('/api/admin/sop-runs', start([{ itemIndex: 2 }]));
    expect(second.status()).toBe(200);
    const joined = (await second.json()) as {
      run: { id: string; status: string };
      checks: { item_index: number; checked_by: string }[];
      resumed: boolean;
    };
    expect(joined.resumed).toBe(true);
    expect(joined.run.id).toBe(run.id);
    expect(joined.checks.map((c) => [c.item_index, c.checked_by]).sort()).toEqual([
      [0, STAFF.email],
      [2, STAFF_2.email],
    ]);
  });

  test('a required item cannot be skipped; an optional one can', async ({ as }) => {
    const staff = await as(STAFF);
    const created = await staff.post('/api/admin/sop-runs', start([{ itemIndex: 0 }]));
    const { run } = (await created.json()) as { run: { id: string } };

    const skipRequired = await staff.patch('/api/admin/sop-runs', {
      data: { runId: run.id, action: 'check', itemIndex: 1, skipped: true },
    });
    expect(skipRequired.status()).toBe(400);

    const skipOptional = await staff.patch('/api/admin/sop-runs', {
      data: { runId: run.id, action: 'check', itemIndex: 2, skipped: true },
    });
    expect(skipOptional.status()).toBe(200);
  });

  test('the last item completes the run, which then refuses changes', async ({ as, db }) => {
    const staff = await as(STAFF);
    const created = await staff.post('/api/admin/sop-runs', {
      data: { sopId: sop.id, checkAll: true },
    });
    expect(created.status()).toBe(201);
    const { run } = (await created.json()) as { run: { id: string; status: string } };
    expect(run.status).toBe('completed');

    const late = await staff.patch('/api/admin/sop-runs', {
      data: { runId: run.id, action: 'uncheck', itemIndex: 0 },
    });
    expect(late.status()).toBe(409);
    const { data } = await db.from('sop_runs').select('status').eq('id', run.id).single();
    expect(data?.status).toBe('completed');
  });

  test('a run left open from an earlier day is closed, not resumed', async ({ as, db }) => {
    const { data: stale, error } = await db
      .from('sop_runs')
      .insert({
        sop_id: sop.id,
        sop_version: 1,
        task_count: 3,
        started_by: STAFF_2.email,
        started_at: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const staff = await as(STAFF);
    const tick = await staff.patch('/api/admin/sop-runs', {
      data: { runId: stale?.id, action: 'check', itemIndex: 0 },
    });
    expect(tick.status()).toBe(409);
    expect(await tick.json()).toMatchObject({ stale: true });
    const { data: closed } = await db
      .from('sop_runs')
      .select('status')
      .eq('id', stale?.id)
      .single();
    expect(closed?.status).toBe('abandoned');

    // Starting again opens today's run instead.
    const fresh = await staff.post('/api/admin/sop-runs', start([{ itemIndex: 0 }]));
    expect(fresh.status()).toBe(201);
  });
});

test.describe('editing', { tag: DESKTOP_ONLY_TAG }, () => {
  test('saving makes a new version, notifies readers, and refuses a stale base', async ({
    as,
    db,
  }, testInfo) => {
    const admin = await as(ADMIN);
    const sop = await createSop(admin, {
      slug: uniqueSlug(testInfo, 'edit'),
      viewRoles: ['staff', 'shift_lead'],
      editRoles: ['admin', 'staff'],
    });
    const staff = await as(STAFF);

    const saved = await staff.put('/api/admin/sops', {
      data: {
        id: sop.id,
        title: sop.title,
        content: `${CHECKLIST}\n- [ ] Switch off the lights`,
        baseVersion: 1,
        changeNote: 'Lights too',
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    expect(((await saved.json()) as { sop: CreatedSop }).sop.current_version).toBe(2);

    const history = await staff.get(`/api/admin/sops?id=${sop.id}&view=versions`);
    const { versions } = (await history.json()) as {
      versions: { version: number; change_note: string | null; edited_by: string }[];
    };
    expect(versions.map((v) => [v.version, v.change_note, v.edited_by])).toEqual([
      [2, 'Lights too', STAFF.email],
      [1, 'Created', ADMIN.email],
    ]);

    // Someone else saved v2 while this edit started from v1.
    const stale = await staff.put('/api/admin/sops', {
      data: { id: sop.id, title: sop.title, content: 'Overwrite', baseVersion: 1 },
    });
    expect(stale.status()).toBe(409);

    // Readers hear about the save; the editor doesn't. (The admin's create
    // notified everyone, the editor included; those rows have the admin as
    // actor.)
    const { data: notices } = await db
      .from('staff_notifications')
      .select('recipient_email')
      .eq('kind', 'sop_updated')
      .eq('source_id', sop.id)
      .eq('actor_email', STAFF.email);
    const recipients = (notices ?? []).map((n) => n.recipient_email);
    expect(recipients).toContain(STAFF_2.email);
    expect(recipients).toContain(SHIFT_LEAD.email);
    expect(recipients).not.toContain(STAFF.email);
  });

  test('a reader without an edit grant cannot save', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const sop = await createSop(admin, { slug: uniqueSlug(testInfo, 'noedit') });
    const staff = await as(STAFF);
    const response = await staff.put('/api/admin/sops', {
      data: { id: sop.id, title: sop.title, content: 'Changed', baseVersion: 1 },
    });
    expect(response.status()).toBe(403);
  });

  test('only an admin creates SOPs', async ({ as }, testInfo) => {
    const staff = await as(STAFF);
    const response = await staff.post('/api/admin/sops', {
      data: { title: 'Not allowed', slug: uniqueSlug(testInfo, 'nope'), content: CHECKLIST },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('who can read what', { tag: DESKTOP_ONLY_TAG }, () => {
  const read = async (as: (role: Role) => Promise<APIRequestContext>, role: Role, id: string) =>
    (await (await as(role)).get(`/api/admin/sops?id=${id}`)).status();

  test('an admin-only document is not found for staff', async ({ as }, testInfo) => {
    const sop = await createSop(await as(ADMIN), {
      slug: uniqueSlug(testInfo, 'hidden'),
      viewRoles: ['admin'],
    });
    expect(await read(as, STAFF, sop.id)).toBe(404);
    expect(await read(as, ADMIN, sop.id)).toBe(200);
  });

  test('role grants are a set: shift lead does not admit staff', async ({ as }, testInfo) => {
    const sop = await createSop(await as(ADMIN), {
      slug: uniqueSlug(testInfo, 'leads'),
      viewRoles: ['shift_lead'],
    });
    expect(await read(as, SHIFT_LEAD, sop.id)).toBe(200);
    expect(await read(as, STAFF, sop.id)).toBe(404);
  });

  test('a person named on the document can read it', async ({ as }, testInfo) => {
    const sop = await createSop(await as(ADMIN), {
      slug: uniqueSlug(testInfo, 'named'),
      viewRoles: ['admin'],
      viewEmails: [STAFF_2.email],
    });
    expect(await read(as, STAFF_2, sop.id)).toBe(200);
    expect(await read(as, STAFF, sop.id)).toBe(404);
  });

  test('archived documents disappear for staff, and only then can be deleted', async ({
    as,
  }, testInfo) => {
    const admin = await as(ADMIN);
    const sop = await createSop(admin, { slug: uniqueSlug(testInfo, 'archive') });

    const early = await admin.delete(`/api/admin/sops?id=${sop.id}`);
    expect(early.status()).toBe(400);

    const archived = await admin.patch('/api/admin/sops', { data: { id: sop.id, archived: true } });
    expect(archived.status()).toBe(200);
    expect(await read(as, STAFF, sop.id)).toBe(404);
    expect(await read(as, ADMIN, sop.id)).toBe(200);
    const run = await (await as(ADMIN)).post('/api/admin/sop-runs', {
      data: { sopId: sop.id, initialChecks: [{ itemIndex: 0 }] },
    });
    expect(run.status()).toBe(400);

    const deleted = await admin.delete(`/api/admin/sops?id=${sop.id}`);
    expect(deleted.status()).toBe(200);
    expect(await read(as, ADMIN, sop.id)).toBe(404);
  });

  test('the print view leaves out documents the reader cannot see', async ({ as }, testInfo) => {
    const admin = await as(ADMIN);
    const open = await createSop(admin, { slug: uniqueSlug(testInfo, 'print-open') });
    const hidden = await createSop(admin, {
      slug: uniqueSlug(testInfo, 'print-hidden'),
      viewRoles: ['admin'],
    });
    const response = await (await as(STAFF)).get(
      `/admin/sops/print?slugs=${open.slug},${hidden.slug}`
    );
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(open.title);
    expect(html).not.toContain(hidden.title);
  });
});
