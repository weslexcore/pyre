// Shift notes: anyone on the floor leaves a note for the next shift, can
// @mention a teammate, and reply. Admins triage (status) and can keep notes
// and replies to themselves.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN, STAFF, STAFF_2 } from './roles';
import { test as base, expect } from './schedule-helpers';
import { open } from './test';

/** A tag for every note this test writes; its notes are deleted when it ends. */
const test = base.extend<{ tag: string }>({
  tag: async ({ db }, use, testInfo) => {
    const tag = uniqueTag(testInfo, 'note');
    await use(tag);
    await db.from('shift_notes').delete().like('body', `%${tag}%`);
  },
});

test.describe.configure({ mode: 'parallel' });

async function noteByTag(db: SupabaseClient, tag: string) {
  const { data } = await db
    .from('shift_notes')
    .select('id, author_email, admin_only, status, body')
    .like('body', `%${tag}%`)
    .maybeSingle();
  return data as {
    id: string;
    author_email: string;
    admin_only: boolean;
    status: string;
    body: string;
  } | null;
}

test.describe('writing a note', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('it is saved, listed, and the person mentioned is told', async ({ page, db, tag }) => {
    await open(page, '/admin/shift-notes');
    // The page's own composer; the header has a quick-note one too.
    const main = page.getByRole('main');
    await main
      .getByLabel("What's worth noting")
      .fill(`Towels are low, @${STAFF_2.email} can you restock? ${tag}`);
    await main.getByRole('button', { name: 'Add note' }).click();

    await expect(page.getByText(tag).first()).toBeVisible();
    // The list shows the note as soon as it's sent; the row lands a moment later.
    await expect.poll(async () => (await noteByTag(db, tag))?.author_email).toBe(STAFF.email);
    const note = await noteByTag(db, tag);

    await expect
      .poll(async () => {
        const { data } = await db
          .from('staff_notifications')
          .select('kind')
          .eq('recipient_email', STAFF_2.email)
          .eq('source_id', note?.id as string);
        return (data ?? []).map((row) => row.kind);
      })
      .toContain('mention');
  });
});

test.describe('the rules', { tag: DESKTOP_ONLY_TAG }, () => {
  async function write(
    client: APIRequestContext,
    body: string,
    adminOnly = false
  ): Promise<string> {
    const response = await client.post('/api/admin/shift-notes', {
      data: { noteDate: todayEastern(), body, adminOnly },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    return ((await response.json()).note as { id: string }).id;
  }

  test('an admin-only note is hidden from staff', async ({ as, tag }) => {
    const id = await write(await as(ADMIN), `Petty cash count is off ${tag}`, true);

    const list = await (await (await as(STAFF)).get('/api/admin/shift-notes')).json();
    expect((list.notes as { id: string }[]).map((n) => n.id)).not.toContain(id);
    const adminList = await (await (await as(ADMIN)).get('/api/admin/shift-notes')).json();
    expect((adminList.notes as { id: string }[]).map((n) => n.id)).toContain(id);
  });

  test('only the author (or an admin) edits or deletes a note', async ({ as, db, tag }) => {
    const id = await write(await as(STAFF), `Lockers sticky ${tag}`);

    const casey = await as(STAFF_2);
    expect(
      (
        await casey.patch('/api/admin/shift-notes', { data: { id, body: `Edited ${tag}` } })
      ).status()
    ).toBe(403);
    expect((await casey.delete(`/api/admin/shift-notes?id=${id}`)).status()).toBe(403);

    const sam = await as(STAFF);
    expect(
      (
        await sam.patch('/api/admin/shift-notes', { data: { id, body: `Lockers fixed ${tag}` } })
      ).status()
    ).toBe(200);
    expect((await noteByTag(db, tag))?.body).toContain('Lockers fixed');
    expect((await sam.delete(`/api/admin/shift-notes?id=${id}`)).status()).toBe(200);
    expect(await noteByTag(db, tag)).toBeNull();
  });

  test('only admins change a note’s status', async ({ as, db, tag }) => {
    const id = await write(await as(STAFF), `Sauna 2 heater flickering ${tag}`);

    expect(
      (
        await (
          await as(STAFF)
        ).patch('/api/admin/shift-notes', { data: { id, status: 'resolved' } })
      ).status()
    ).toBe(403);
    expect(
      (
        await (
          await as(ADMIN)
        ).patch('/api/admin/shift-notes', { data: { id, status: 'resolved' } })
      ).status()
    ).toBe(200);
    expect((await noteByTag(db, tag))?.status).toBe('resolved');
  });

  test('replies: staff can’t make one private; an admin’s private reply stays with admins', async ({
    as,
    tag,
  }) => {
    const id = await write(await as(STAFF), `Guest left a ring ${tag}`);

    const staffReply = await (await as(STAFF_2)).post('/api/admin/shift-note-replies', {
      data: { noteId: id, body: 'In the safe now', isPrivate: true },
    });
    expect(staffReply.status()).toBe(201);
    expect((await staffReply.json()).reply.is_private).toBe(false);

    const adminReply = await (await as(ADMIN)).post('/api/admin/shift-note-replies', {
      data: { noteId: id, body: 'Owner called, picking up Friday', isPrivate: true },
    });
    expect((await adminReply.json()).reply.is_private).toBe(true);

    const bodies = async (role: typeof STAFF) => {
      const res = await (await as(role)).get(`/api/admin/shift-note-replies?noteId=${id}`);
      const json = await res.json();
      return ((json.replies ?? []) as { body: string }[]).map((r) => r.body);
    };
    expect(await bodies(STAFF)).toContain('In the safe now');
    expect(await bodies(STAFF)).not.toContain('Owner called, picking up Friday');
    expect(await bodies(ADMIN)).toContain('Owner called, picking up Friday');
  });
});
