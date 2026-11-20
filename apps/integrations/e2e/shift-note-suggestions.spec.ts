// Suggestions from a shift note's thread: a reply on a note has the
// suggestion agent look at the note again, thread and all, so an answer
// like "we have 3 left, order a case" turns into suggestions the way the
// note itself would have. And what the agent saves from a reply: a count
// credited to whoever wrote the reply, and tasks on the people the thread
// names (active staff only) by the date it gives.
//
// The agent is the mock Eve app (mock-server/eve.ts), where suggester
// sessions only park; the spec plays the suggester by saving through the
// app's real /api/agent/suggestions with the run the session was opened on.
// Which suggestions a model would make from a thread is the evals' job
// (apps/agents/evals/suggest-reply.eval.ts), not tested here. Automatic
// suggestions are on for the suite (auth.setup.ts), and classification is
// off, so the only runs a note gets are the ones its replies start.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { addDays, todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_API_SECRET } from './agent-secrets';
import { eve } from './pyre-agent-helpers';
import { ADMIN, STAFF, STAFF_2 } from './roles';
import { test as base, expect } from './test';

const agentAuth = { Authorization: `Bearer ${AGENT_API_SECRET}` };

interface Cleanup {
  notes: string[];
  items: string[];
}

/** A tag for this test's notes and items, and everything they led to removed when it ends. */
const test = base.extend<{ tag: string; made: Cleanup }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  tag: async ({}, use, testInfo) => {
    await use(uniqueTag(testInfo, 'thread'));
  },
  made: async ({ db }, use) => {
    const made: Cleanup = { notes: [], items: [] };
    await use(made);
    if (made.notes.length > 0) {
      await db.from('agent_suggestions').delete().in('source_id', made.notes);
      await db.from('agent_suggestion_runs').delete().in('source_id', made.notes);
      await db.from('staff_notifications').delete().in('source_id', made.notes);
      await db.from('shift_notes').delete().in('id', made.notes);
    }
    if (made.items.length > 0) {
      await db.from('inventory_history').delete().in('item_id', made.items);
      await db.from('inventory').delete().in('id', made.items);
    }
  },
});

test.describe.configure({ mode: 'parallel' });

async function writeNote(client: APIRequestContext, made: Cleanup, body: string): Promise<string> {
  const response = await client.post('/api/admin/shift-notes', {
    data: { noteDate: todayEastern(), body },
  });
  expect(response.status(), await response.text()).toBeLessThan(300);
  const id = ((await response.json()).note as { id: string }).id;
  made.notes.push(id);
  return id;
}

async function reply(
  client: APIRequestContext,
  noteId: string,
  body: string
): Promise<{ id: string; created_at: string }> {
  const response = await client.post('/api/admin/shift-note-replies', {
    data: { noteId, body },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).reply as { id: string; created_at: string };
}

/** The suggester sessions the app opened on one note, oldest first. */
async function suggesterSessions(noteId: string) {
  return (await eve.sessions())
    .filter((s) => s.role === 'suggester' && s.suggestSource === `shift_note:${noteId}`)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The note's automatic runs, oldest first. */
async function autoRuns(db: SupabaseClient, noteId: string) {
  const { data, error } = await db
    .from('agent_suggestion_runs')
    .select('id, source_hash, trigger')
    .eq('source_type', 'shift_note')
    .eq('source_id', noteId)
    .eq('trigger', 'auto')
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as { id: string; source_hash: string; trigger: string }[];
}

/** Wait for the suggester to be started on the note (the reply's work runs after its response). */
async function waitForRun(db: SupabaseClient, noteId: string, count = 1): Promise<string> {
  await expect.poll(async () => (await suggesterSessions(noteId)).length).toBe(count);
  const sessions = await suggesterSessions(noteId);
  const runId = sessions[count - 1]?.suggestRunId;
  expect(runId, 'the session carries its run').toBeTruthy();
  expect((await autoRuns(db, noteId)).map((r) => r.id)).toContain(runId);
  return runId as string;
}

/** Play the suggester: save (or, with dryRun, only check) suggestions for the run. */
async function save(
  request: APIRequestContext,
  runId: string,
  suggestions: unknown[],
  dryRun = false
) {
  const response = await request.post('/api/agent/suggestions', {
    headers: agentAuth,
    data: { runId, dryRun, suggestions },
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

// API flows: they run once, not per device.
test.describe('a reply has the suggester read the note again', { tag: DESKTOP_ONLY_TAG }, () => {
  test('once per version of the thread: a reply, then an edit to it', async ({
    as,
    db,
    made,
    tag,
  }) => {
    const id = await writeNote(await as(STAFF), made, `Eucalyptus is low, should I order? ${tag}`);
    expect(await suggesterSessions(id)).toEqual([]);

    const admin = await as(ADMIN);
    const answer = await reply(admin, id, 'We have 2 bottles left, order a case.');
    await waitForRun(db, id, 1);

    const edited = await admin.patch('/api/admin/shift-note-replies', {
      data: { id: answer.id, body: 'Actually 3 bottles left. Order a case.' },
    });
    expect(edited.status(), await edited.text()).toBe(200);
    await waitForRun(db, id, 2);

    // Each run read a different version of the thread.
    const hashes = (await autoRuns(db, id)).map((r) => r.source_hash);
    expect(new Set(hashes).size).toBe(2);
  });

  test('a resolved note is left alone', async ({ as, db, made, tag }) => {
    const admin = await as(ADMIN);
    const resolved = await writeNote(await as(STAFF), made, `Front door lock sticks ${tag} done`);
    const status = await admin.patch('/api/admin/shift-notes', {
      data: { id: resolved, status: 'resolved' },
    });
    expect(status.status(), await status.text()).toBe(200);
    await reply(admin, resolved, 'Fixed it this morning.');

    // An open note replied to afterwards gets its run, so the resolved
    // note's reply has had its turn by then.
    const open = await writeNote(await as(STAFF), made, `Sauna 2 light flickers ${tag} open`);
    await reply(admin, open, 'Sam, can you swap the bulb?');
    await waitForRun(db, open);

    expect(await suggesterSessions(resolved)).toEqual([]);
    expect(await autoRuns(db, resolved)).toEqual([]);
  });
});

test.describe('what the suggester saves from a thread', { tag: DESKTOP_ONLY_TAG }, () => {
  test('a count read from a reply is credited to the reply’s author', async ({
    as,
    db,
    made,
    request,
    tag,
  }) => {
    const { data: item, error } = await db
      .from('inventory')
      .insert({ name: `Eval towels ${tag}`, in_stock: 10, created_by: 'e2e', active: true })
      .select('id')
      .single();
    expect(error).toBeNull();
    const itemId = (item as { id: string }).id;
    made.items.push(itemId);

    const id = await writeNote(await as(STAFF), made, `Can someone count the towels? ${tag}`);
    const counted = await reply(await as(STAFF_2), id, 'Counted them: 3 left.');
    const runId = await waitForRun(db, id);

    const count = (replyId: string) => ({
      kind: 'inventory.count',
      rationale: 'The reply says 3 are left.',
      replyId,
      payload: { itemId, inStock: 3 },
    });

    // A reply that isn't on this note is refused, naming the suggestion.
    const stranger = await save(request, runId, [count('00000000-0000-4000-8000-000000000000')]);
    expect(stranger.status).toBe(422);
    expect(stranger.body.index).toBe(0);

    const saved = await save(request, runId, [count(counted.id)]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ saved: true, count: 1 });

    const { data: rows } = await db
      .from('agent_suggestions')
      .select('id, payload')
      .eq('run_id', runId);
    const suggestion = (rows ?? [])[0] as {
      id: string;
      payload: { countedBy: string; countedAt: string };
    };
    expect(suggestion.payload.countedBy).toBe(STAFF_2.email);
    expect(Date.parse(suggestion.payload.countedAt)).toBe(Date.parse(counted.created_at));

    // Approving it records the reply's author as the one who counted.
    const approved = await (await as(ADMIN)).post('/api/admin/suggestions', {
      data: { action: 'approve', id: suggestion.id },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    await expect
      .poll(
        async () =>
          (await db.from('inventory').select('in_stock, last_counted_by').eq('id', itemId).single())
            .data
      )
      .toEqual({ in_stock: 3, last_counted_by: STAFF_2.email });
  });

  test('a task goes to the people the thread names, when they are on the roster', async ({
    as,
    db,
    made,
    request,
    tag,
  }) => {
    const id = await writeNote(await as(STAFF), made, `Sauna 2 heater is slow ${tag}`);
    await reply(await as(ADMIN), id, 'Casey, can you call the repair company by Friday?');
    const runId = await waitForRun(db, id);

    const dueDate = addDays(todayEastern(), 3);
    const card = (extra: Record<string, unknown>) => ({
      kind: 'board_card.create',
      rationale: 'The heater needs a repair call.',
      payload: {
        board: 'goals',
        title: `Call heater repair ${tag}`,
        severity: 'medium',
        importance: 'medium',
        ...extra,
      },
    });

    // Someone off the roster (an address written into a note) is refused.
    const outsider = await save(
      request,
      runId,
      [card({ assigneeEmails: ['owner@pyresauna.com'] })],
      true
    );
    expect(outsider.status).toBe(422);
    expect(outsider.body.index).toBe(0);
    expect(String(outsider.body.error)).toContain('owner@pyresauna.com');

    // Named people and the thread's date are kept; with nobody named the
    // card falls to the board's default assignees.
    const checked = await save(
      request,
      runId,
      [card({ assigneeEmails: [STAFF_2.email.toUpperCase()], dueDate }), card({})],
      true
    );
    expect(checked.status, JSON.stringify(checked.body)).toBe(200);
    const [named, nobody] = checked.body.suggestions as {
      payload: { assigneeEmails: string[]; dueDate: string | null };
    }[];
    expect(named?.payload.assigneeEmails).toEqual([STAFF_2.email]);
    expect(named?.payload.dueDate).toBe(dueDate);

    const { data: board } = await db
      .from('boards')
      .select('default_assignee_emails')
      .eq('slug', 'goals')
      .single();
    expect(nobody?.payload.assigneeEmails).toEqual(
      (board as { default_assignee_emails: string[] | null }).default_assignee_emails ?? []
    );
  });
});
