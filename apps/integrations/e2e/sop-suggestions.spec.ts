// Knowledge into the SOP library: Pyre Agent (from a chat, or from the shift
// notes and messages it read in one) and the shift-note suggester can
// suggest a whole new SOP, or a new section of an existing one, and nothing
// changes until it is approved. Approving a new SOP creates it as the
// approving admin, through the same path as the New SOP form, so it is an
// ordinary document the knowledge agent and the team can read.
//
// The agent is played straight through the app's real agent routes:
// /api/agent/pyre (op 'suggest') for the chat, /api/agent/suggestions for
// the suggester. Everything after that (intake, the review routes and inbox,
// the database) is the real thing. Which document a model would write is
// the evals' job, not tested here.
//
// API flows run once (desktop only); the review in the inbox runs on every
// device project.

import type { APIRequestContext } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_API_SECRET } from './agent-secrets';
import { eve, pyreOp } from './pyre-agent-helpers';
import { ADMIN, SCHEDULE_VIEWER, STAFF } from './roles';
import { createSop, uniqueSlug } from './sops-helpers';
import { test as base, expect, open } from './test';

const REVIEW_API = '/api/admin/suggestions';
const agentAuth = { Authorization: `Bearer ${AGENT_API_SECRET}` };

interface Made {
  /** Chat session ids (pyre_agent suggestion sources) and shift note ids. */
  sources: string[];
  notes: string[];
  slugs: string[];
  categories: string[];
}

function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Everything a test made — suggestions, the SOPs they created, sections, notes — removed when it ends. */
const test = base.extend<{ tag: string; made: Made }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures need the destructuring
  tag: async ({}, use, testInfo) => {
    await use(uniqueTag(testInfo, 'sop-suggest').replace(/\s+/g, '-'));
  },
  made: async ({ db }, use) => {
    const made: Made = { sources: [], notes: [], slugs: [], categories: [] };
    await use(made);
    const sources = [...made.sources, ...made.notes];
    if (made.slugs.length > 0) {
      const { data } = await db.from('sops').select('id').in('slug', made.slugs);
      const ids = ((data ?? []) as { id: string }[]).map((s) => s.id);
      if (ids.length > 0) {
        check((await db.from('sop_versions').delete().in('sop_id', ids)).error, 'clear versions');
        check((await db.from('sops').delete().in('id', ids)).error, 'clear SOPs');
      }
    }
    if (sources.length > 0) {
      check(
        (await db.from('agent_suggestions').delete().in('source_id', sources)).error,
        'clear suggestions'
      );
      check(
        (await db.from('agent_suggestion_runs').delete().in('source_id', sources)).error,
        'clear runs'
      );
      check(
        (await db.from('staff_notifications').delete().in('source_id', sources)).error,
        'clear notifications'
      );
    }
    if (made.notes.length > 0) {
      check((await db.from('shift_notes').delete().in('id', made.notes)).error, 'clear notes');
    }
    if (made.categories.length > 0) {
      check(
        (await db.from('sop_categories').delete().in('name', made.categories)).error,
        'clear sections'
      );
    }
  },
});

test.describe.configure({ mode: 'parallel' });

interface Filed {
  status: number;
  body: {
    suggestion?: { id: string; kind: string; summary: string };
    reviewer?: 'you' | 'admins';
    error?: string;
  };
}

/** Pyre Agent files one suggestion in `session`'s conversation, as `email`. */
async function suggest(
  request: APIRequestContext,
  email: string,
  session: string,
  kind: 'sop.create' | 'sop.edit',
  payload: Record<string, unknown>,
  rationale = 'From the chat: the team explained this and no SOP has it.'
): Promise<Filed> {
  return (await pyreOp(request, email, 'suggest', { kind, payload, rationale }, session)) as Filed;
}

async function approve(admin: APIRequestContext, id: string, payload?: unknown) {
  const response = await admin.post(REVIEW_API, {
    data: { action: 'approve', id, ...(payload ? { payload } : {}) },
  });
  return {
    status: response.status(),
    body: (await response.json()) as { result?: { label: string; href: string | null } },
  };
}

async function sopBySlug(db: SupabaseClient, slug: string) {
  const { data, error } = await db
    .from('sops')
    .select('id, title, category, content_md, current_version, view_roles, edit_roles, created_by')
    .eq('slug', slug)
    .maybeSingle();
  expect(error).toBeNull();
  return data as {
    id: string;
    title: string;
    category: string;
    content_md: string;
    current_version: number;
    view_roles: string[];
    edit_roles: string[];
    created_by: string;
  } | null;
}

test.describe('a new SOP from the chat', { tag: DESKTOP_ONLY_TAG }, () => {
  test('goes to the admins, and approving it adds it to the library', async ({
    as,
    db,
    made,
    request,
    tag,
  }, testInfo) => {
    const session = `${tag}-chat`;
    made.sources.push(session);
    const slug = uniqueSlug(testInfo, 'late');
    made.slugs.push(slug);
    const category = `E2E Guests ${tag}`;
    made.categories.push(category);
    const title = `Late arrivals ${tag}`;
    const contentMd = '# Late arrivals\n\n## When a guest is late\n\n- Offer the next open slot';

    // Someone who doesn't decide suggestions: it goes to the admins.
    const filed = await suggest(request, SCHEDULE_VIEWER.email, session, 'sop.create', {
      title,
      slug,
      category,
      contentMd,
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    expect(filed.body.reviewer).toBe('admins');
    expect(filed.body.suggestion).toMatchObject({
      kind: 'sop.create',
      summary: `New SOP: ${title} (${category})`,
    });
    const id = filed.body.suggestion?.id as string;
    expect(await sopBySlug(db, slug), 'nothing is created before approval').toBeNull();

    // Floor staff can't decide it.
    const refused = await (await as(STAFF)).post(REVIEW_API, { data: { action: 'approve', id } });
    expect(refused.status()).toBe(403);

    const approved = await approve(await as(ADMIN), id);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.result).toEqual({ label: title, href: `/admin/sops/${slug}` });

    // An ordinary SOP: created by the approving admin, readable by everyone,
    // edited by admins, filed under its section, with v1 tied to the suggestion.
    const sop = await sopBySlug(db, slug);
    expect(sop).toMatchObject({
      title,
      category,
      content_md: `${contentMd}\n`,
      current_version: 1,
      view_roles: ['staff', 'shift_lead', 'admin'],
      edit_roles: ['admin'],
      created_by: ADMIN.email,
    });
    const { data: v1 } = await db
      .from('sop_versions')
      .select('version, suggestion_id, change_note, edited_by')
      .eq('sop_id', sop?.id as string)
      .single();
    expect(v1).toMatchObject({ version: 1, suggestion_id: id, edited_by: ADMIN.email });
    expect((v1 as { change_note: string }).change_note).toMatch(/^Created \(suggested/);
    const { data: section } = await db
      .from('sop_categories')
      .select('name')
      .eq('name', category)
      .maybeSingle();
    expect(section, 'a new section is made real in the library').not.toBeNull();

    // Floor staff can read it, so the knowledge agent finds it for them too.
    const read = await (await as(STAFF)).get(`/api/admin/sops?slug=${slug}`);
    expect(read.status(), await read.text()).toBe(200);

    // A second document on the same topic is refused while the agent can
    // still turn it into an edit of the first.
    const again = await suggest(request, SCHEDULE_VIEWER.email, session, 'sop.create', {
      title,
      category,
      contentMd,
    });
    expect(again.status).toBe(422);
    expect(again.body.error).toContain(slug);
  });

  test('an admin can narrow who reads it, and edit it before approving', async ({
    as,
    db,
    made,
    request,
    tag,
  }, testInfo) => {
    const session = `${tag}-chat`;
    made.sources.push(session);
    const slug = uniqueSlug(testInfo, 'cash');
    made.slugs.push(slug);

    const filed = await suggest(request, ADMIN.email, session, 'sop.create', {
      title: `Cash drawer ${tag}`,
      slug,
      category: 'General',
      contentMd: '# Cash drawer\n\n- Count it at close',
      viewRoles: ['shift_lead'],
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    // An admin decides it right in the chat.
    expect(filed.body.reviewer).toBe('you');
    const id = filed.body.suggestion?.id as string;

    const { data: row } = await db
      .from('agent_suggestions')
      .select('payload')
      .eq('id', id)
      .single();
    const payload = (row as { payload: Record<string, unknown> }).payload;
    expect(payload.viewRoles).toEqual(['shift_lead', 'admin']);

    const approved = await approve(await as(ADMIN), id, {
      ...payload,
      contentMd: '# Cash drawer\n\n- Count it at close\n- Lock it in the office',
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const sop = await sopBySlug(db, slug);
    expect(sop?.content_md).toContain('Lock it in the office');
    expect(sop?.view_roles).toEqual(['shift_lead', 'admin']);

    // Floor staff can't open a leads-only document.
    const read = await (await as(STAFF)).get(`/api/admin/sops?slug=${slug}`);
    expect(read.status()).toBe(404);
  });
});

test.describe('a new section of an SOP from the chat', { tag: DESKTOP_ONLY_TAG }, () => {
  test('lands before the heading it names, or at the end', async ({
    as,
    db,
    made,
    request,
    tag,
  }, testInfo) => {
    const session = `${tag}-chat`;
    made.sources.push(session);
    const admin = await as(ADMIN);
    const sop = await createSop(admin, {
      slug: uniqueSlug(testInfo, 'arrivals'),
      content: '# Arrivals\n\n## Check-in\n- Greet them\n\n## Closing time\n- Lock up',
    });
    made.slugs.push(sop.slug);

    // A heading that isn't in the document is refused, naming the edit.
    const wrong = await suggest(request, ADMIN.email, session, 'sop.edit', {
      slug: sop.slug,
      baseVersion: 1,
      edits: [{ section: '## Towels\n- Restock', before: '## Closing' }],
      changeNote: 'Add towels',
    });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toContain('edits[0]');

    const filed = await suggest(request, ADMIN.email, session, 'sop.edit', {
      slug: sop.slug,
      baseVersion: 1,
      edits: [
        { section: '## Towels\n- Restock the shelf', before: '## Closing time' },
        { section: '## Late arrivals\n- Offer the next open slot' },
      ],
      changeNote: 'Add towels and late arrivals',
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    const approved = await approve(admin, filed.body.suggestion?.id as string);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const saved = await sopBySlug(db, sop.slug);
    expect(saved?.current_version).toBe(2);
    expect(saved?.content_md).toBe(
      [
        '# Arrivals',
        '',
        '## Check-in',
        '- Greet them',
        '',
        '## Towels',
        '- Restock the shelf',
        '',
        '## Closing time',
        '- Lock up',
        '',
        '## Late arrivals',
        '- Offer the next open slot',
        '',
      ].join('\n')
    );
  });
});

test.describe('a new SOP from a shift note', { tag: DESKTOP_ONLY_TAG }, () => {
  test('the suggester files one, and its v1 links back to the note', async ({
    as,
    db,
    made,
    request,
    tag,
  }, testInfo) => {
    const response = await (await as(STAFF)).post('/api/admin/shift-notes', {
      data: {
        noteDate: todayEastern(),
        body: `How do we reset the steam generator? ${tag}`,
      },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const noteId = ((await response.json()).note as { id: string }).id;
    made.notes.push(noteId);
    // A reply starts the suggester on the note (suggestions are automatic in the suite).
    const replied = await (await as(ADMIN)).post('/api/admin/shift-note-replies', {
      data: { noteId, body: 'Hold the reset button 10 seconds, then wait 2 minutes.' },
    });
    expect(replied.status(), await replied.text()).toBe(201);
    await expect
      .poll(
        async () =>
          (await eve.sessions()).filter(
            (s) => s.role === 'suggester' && s.suggestSource === `shift_note:${noteId}`
          ).length
      )
      .toBe(1);
    const runId = (await eve.sessions()).find((s) => s.suggestSource === `shift_note:${noteId}`)
      ?.suggestRunId as string;

    const slug = uniqueSlug(testInfo, 'steam');
    made.slugs.push(slug);
    const saved = await request.post('/api/agent/suggestions', {
      headers: agentAuth,
      data: {
        runId,
        suggestions: [
          {
            kind: 'sop.create',
            rationale: 'The reply explains a reset no SOP covers.',
            payload: {
              title: `Steam generator reset ${tag}`,
              slug,
              category: 'General',
              contentMd: '# Steam generator reset\n\n- Hold reset 10 seconds\n- Wait 2 minutes',
            },
          },
        ],
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const { data: rows } = await db
      .from('agent_suggestions')
      .select('id, kind')
      .eq('run_id', runId);
    expect(rows).toEqual([expect.objectContaining({ kind: 'sop.create' })]);
    const id = (rows as { id: string }[])[0]?.id as string;

    const admin = await as(ADMIN);
    const approved = await approve(admin, id);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    // The History panel links the first version back to the note.
    const history = await admin.get(`/api/admin/sops?slug=${slug}&view=versions`);
    expect(history.status(), await history.text()).toBe(200);
    const { versions, origins } = (await history.json()) as {
      versions: { id: string; suggestion_id: string | null }[];
      origins: Record<string, { href: string | null }>;
    };
    expect(versions).toHaveLength(1);
    expect(versions[0]?.suggestion_id).toBe(id);
    expect(origins[versions[0]?.id as string]?.href).toContain(noteId);
  });
});

test.describe('reviewing a new SOP in the inbox', () => {
  test.use({ storageState: ADMIN.storageState as string });

  test('an admin edits its section and approves it', async ({
    db,
    made,
    page,
    request,
    tag,
  }, testInfo) => {
    const session = `${tag}-chat`;
    made.sources.push(session);
    const slug = uniqueSlug(testInfo, 'plunge');
    made.slugs.push(slug);
    const category = `E2E Water ${tag}`;
    made.categories.push(category);
    const title = `Cold plunge etiquette ${tag}`;
    // The card shows the rationale as text (the title is in an input), so it finds the card.
    const rationale = `The chat explained plunge etiquette ${tag}.`;
    const filed = await suggest(
      request,
      SCHEDULE_VIEWER.email,
      session,
      'sop.create',
      { title, slug, category: 'General', contentMd: '# Cold plunge etiquette\n\n- Shower first' },
      rationale
    );
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);

    await open(page, '/admin/suggestions');
    await page.getByRole('combobox').filter({ hasText: 'Any kind' }).selectOption('sop.create');

    // The inbox shows each suggestion open, editor and all.
    const card = page.getByRole('article').filter({ hasText: rationale });
    await expect(card.getByLabel('Title')).toHaveValue(title);
    await expect(card.getByLabel('Document')).toHaveValue(/Shower first/);
    await card.getByLabel('Library section').fill(category);
    await card.getByRole('button', { name: 'Approve with edits' }).click();
    // Decided, the card folds to its outcome: a link to the new document.
    await expect(page.getByRole('link', { name: title })).toHaveAttribute(
      'href',
      `/admin/sops/${slug}`
    );

    expect((await sopBySlug(db, slug))?.category).toBe(category);
  });
});
