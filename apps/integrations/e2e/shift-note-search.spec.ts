// Finding shift notes by their threads. A note is a conversation, and the
// answer someone is looking for is often a reply ("where are the spare
// filters?" / "back closet, top shelf"), so every search that covers notes
// also matches the comments the person may read on them:
//
//   * the dashboard's search (cmd+K, /api/admin/search), which names who
//     wrote the reply it matched in;
//   * the log's own filter, which a search result lands on, so a note found
//     by a reply is still on screen after the click;
//   * Pyre Agent's knowledge search (the knowledge_search function the
//     pyre-agents assistant calls), on the same rules as reading the log:
//     a non-admin finds the team's shared notes and their own admin-only
//     ones, never someone else's admin-only note.
//
// Everywhere, a private comment is the admins' alone, and the thread's
// recorded events (status changes, edits) are not searched.
//
// API flows run once (desktop only); the search box runs on every device.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN, STAFF, STAFF_2 } from './roles';
import { test as base, expect, open } from './test';

interface NoteHit {
  id: string;
  author: string;
  snippet: string;
  reply_author?: string;
}

/**
 * A word no other test (or seed) has written, for this test's notes and
 * replies: letters only, so full-text search reads it as one token. Its
 * notes are deleted when the test ends.
 */
const test = base.extend<{ word: (label: string) => string; notes: string[] }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  word: async ({}, use, testInfo) => {
    const seed = uniqueTag(testInfo, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(-6);
    await use(
      (label) =>
        `${label}${seed}${Math.random()
          .toString(36)
          .replace(/[^a-z]/g, '')
          .slice(0, 6)}`
    );
  },
  notes: async ({ db }, use) => {
    const notes: string[] = [];
    await use(notes);
    if (notes.length > 0) {
      await db.from('staff_notifications').delete().in('source_id', notes);
      await db.from('agent_suggestion_runs').delete().in('source_id', notes);
      await db.from('shift_notes').delete().in('id', notes);
    }
  },
});

test.describe.configure({ mode: 'parallel' });

async function writeNote(
  client: APIRequestContext,
  notes: string[],
  body: string,
  adminOnly = false
): Promise<string> {
  const response = await client.post('/api/admin/shift-notes', {
    data: { noteDate: todayEastern(), body, adminOnly },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  const id = ((await response.json()).note as { id: string }).id;
  notes.push(id);
  return id;
}

async function reply(client: APIRequestContext, noteId: string, body: string, isPrivate = false) {
  const response = await client.post('/api/admin/shift-note-replies', {
    data: { noteId, body, isPrivate },
  });
  expect(response.status(), await response.text()).toBe(201);
}

/** The dashboard search's shift-note hits for `q`. */
async function searchNotes(client: APIRequestContext, q: string): Promise<NoteHit[]> {
  const response = await client.get(`/api/admin/search?q=${encodeURIComponent(q)}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { notes: NoteHit[] }).notes;
}

/** Pyre Agent's search, as pyre-agents calls it for a person: the note ids it finds. */
async function agentSearch(
  db: SupabaseClient,
  q: string,
  viewer: { email: string; admin: boolean }
): Promise<string[]> {
  const { data, error } = await db.rpc('knowledge_search', {
    p_query: q,
    p_role: viewer.admin ? 'admin' : 'staff',
    p_email: viewer.email,
    p_shift_notes: viewer.admin ? 'all' : 'mine',
    p_incidents: null,
    p_water: false,
    p_limit: 50,
  });
  expect(error).toBeNull();
  return ((data ?? []) as { source: string; ref: string }[])
    .filter((hit) => hit.source === 'shift_note')
    .map((hit) => hit.ref)
    .sort();
}

/**
 * A shared note answered in its thread, a private comment on it, and a
 * teammate's admin-only note whose reply holds the same answer word.
 */
async function seedThreads(
  as: (role: typeof STAFF) => Promise<APIRequestContext>,
  notes: string[],
  word: (label: string) => string
) {
  const answer = word('closet');
  const secret = word('invoice');
  const admin = await as(ADMIN);
  const shared = await writeNote(await as(STAFF_2), notes, 'Where are the spare filters?');
  await reply(admin, shared, `Back ${answer}, top shelf.`);
  await reply(admin, shared, `The supplier ${secret} is disputed.`, true);
  const hidden = await writeNote(await as(STAFF_2), notes, 'Locker seven is broken.', true);
  await reply(admin, hidden, `The key is in the ${answer} too.`);
  // Resolving the shared note records an event in its thread; events are not searched.
  const resolved = await admin.patch('/api/admin/shift-notes', {
    data: { id: shared, status: 'resolved' },
  });
  expect(resolved.status(), await resolved.text()).toBe(200);
  return { answer, secret, shared, hidden };
}

test.describe('the dashboard search', { tag: DESKTOP_ONLY_TAG }, () => {
  test('finds a note by a reply, on the same rules as the log', async ({ as, notes, word }) => {
    const { answer, secret, shared, hidden } = await seedThreads(as, notes, word);
    const staff = await as(STAFF);
    const admin = await as(ADMIN);

    // Floor staff find the shared note by its answer, labelled as a reply,
    // and not the teammate's admin-only note with the same word.
    const found = await searchNotes(staff, answer);
    expect(found.map((hit) => hit.id)).toEqual([shared]);
    expect(found[0]).toMatchObject({
      author: STAFF_2.displayName,
      reply_author: ADMIN.displayName,
      snippet: expect.stringContaining(answer),
    });

    // A private comment is the admins' alone.
    expect(await searchNotes(staff, secret)).toEqual([]);
    expect((await searchNotes(admin, secret)).map((hit) => hit.id)).toEqual([shared]);

    // Admins see every note the answer is in.
    expect((await searchNotes(admin, answer)).map((hit) => hit.id).sort()).toEqual(
      [shared, hidden].sort()
    );

    // A note matched on its own text is not labelled as a reply.
    const own = word('filters');
    const direct = await writeNote(staff, notes, `Out of ${own} again.`);
    await reply(admin, direct, `Ordered more ${own}.`);
    const [hit] = await searchNotes(staff, own);
    expect(hit).toMatchObject({ id: direct, snippet: expect.stringContaining('Out of') });
    expect(hit?.reply_author).toBeUndefined();
  });
});

test.describe("Pyre Agent's search", { tag: DESKTOP_ONLY_TAG }, () => {
  test('finds the team’s shared notes by their replies, never others’ admin-only ones', async ({
    as,
    db,
    notes,
    word,
  }) => {
    const { answer, secret, shared, hidden } = await seedThreads(as, notes, word);
    const staff = { email: STAFF.email, admin: false };
    const admin = { email: ADMIN.email, admin: true };

    // A teammate's shared note, found through its reply.
    expect(await agentSearch(db, answer, staff)).toEqual([shared]);
    expect(await agentSearch(db, answer, admin)).toEqual([shared, hidden].sort());

    // The private comment stays with the admins; the resolve event is not text.
    expect(await agentSearch(db, secret, staff)).toEqual([]);
    expect(await agentSearch(db, secret, admin)).toEqual([shared]);
    expect(await agentSearch(db, 'resolved', admin)).not.toContain(shared);

    // The author still finds their own admin-only note.
    expect(await agentSearch(db, answer, { email: STAFF_2.email, admin: false })).toEqual(
      [shared, hidden].sort()
    );
  });
});

test.describe('searching from the dashboard', () => {
  test.use({ storageState: STAFF.storageState as string });

  test('a reply finds its note, and the log keeps it on screen', async ({
    as,
    notes,
    page,
    word,
  }) => {
    const answer = word('shelf');
    const note = await writeNote(await as(STAFF_2), notes, 'Where do the spare robes go?');
    await reply(await as(ADMIN), note, `Bottom ${answer} in the laundry room.`);

    await open(page, '/admin/shift-notes');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await dialog.getByPlaceholder(/Search pages/).fill(answer);

    const result = dialog
      .getByRole('region', { name: 'Shift notes' })
      .getByRole('option')
      .filter({ hasText: answer });
    await expect(result).toContainText(`in a reply by ${ADMIN.displayName}`);
    await result.click();

    // The log is filtered to the word, and the note it was found in is shown.
    await expect(page).toHaveURL(new RegExp(`/admin/shift-notes\\?q=${answer}#note-${note}`));
    await expect(page.getByText('Where do the spare robes go?')).toBeVisible();
  });
});
