// Board intake: the one public door into the boards. A form (or anything that
// can make an HTTPS request with the intake secret) turns an enquiry into a
// card in a pipeline's first open column, and the people on that board hear
// about it. Redelivering the same submission (externalRef) updates the one
// card. Each test builds its own board, removed when it ends.

import type { APIRequestContext, TestInfo } from '@playwright/test';
import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SECRETS } from './env';
import { ADMIN } from './roles';
import { expect, test } from './test';

const intakeAuth = { authorization: `Bearer ${SECRETS.boardIntake}` };

interface Board {
  id: string;
  slug: string;
  columns: Record<string, string>;
}

/** A rentals-style pipeline: New -> Quoted -> Booked, with two lead fields. */
async function makeBoard(
  admin: APIRequestContext,
  db: SupabaseClient,
  testInfo: TestInfo
): Promise<Board> {
  const slug = `e2e-leads-${testInfo.workerIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await admin.post('/api/admin/boards', {
    data: {
      name: `E2E leads ${slug}`,
      slug,
      cardNoun: 'lead',
      columns: [
        { key: 'new', label: 'New', kind: 'open' },
        { key: 'quoted', label: 'Quoted', kind: 'open' },
        { key: 'booked', label: 'Booked', kind: 'done' },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { data: board, error } = await db.from('boards').select('id').eq('slug', slug).single();
  expect(error).toBeNull();
  const id = (board as { id: string }).id;
  const fields = await db.from('board_fields').insert([
    { board_id: id, key: 'contact_email', label: 'Contact email', kind: 'text', sort_order: 10 },
    { board_id: id, key: 'party_size', label: 'Party size', kind: 'number', sort_order: 20 },
  ]);
  expect(fields.error, 'board fields').toBeNull();
  const { data: columns, error: columnsError } = await db
    .from('board_columns')
    .select('id, key')
    .eq('board_id', id);
  expect(columnsError).toBeNull();
  return {
    id,
    slug,
    columns: Object.fromEntries((columns ?? []).map((c) => [c.key, c.id])),
  };
}

const deliver = (request: APIRequestContext, body: Record<string, unknown>) =>
  request.post('/api/boards/intake', { headers: intakeAuth, data: body });

async function cardsOn(db: SupabaseClient, boardId: string) {
  const { data, error } = await db
    .from('board_cards')
    .select('id, title, column_id, properties, source, created_by, external_ref, notes_md')
    .eq('board_id', boardId);
  expect(error).toBeNull();
  return data ?? [];
}

test.describe.configure({ mode: 'parallel' });
test.describe('board intake', { tag: DESKTOP_ONLY_TAG }, () => {
  let board: Board;

  test.beforeEach(async ({ as, db }, testInfo) => {
    board = await makeBoard(await as(ADMIN), db, testInfo);
  });

  test.afterEach(async ({ db }) => {
    const { error } = await db.from('boards').delete().eq('id', board.id);
    expect(error, 'remove the board').toBeNull();
  });

  test('an enquiry becomes a card in the first column, and the board hears', async ({
    request,
    db,
  }) => {
    const response = await deliver(request, {
      board: board.slug,
      title: 'Group of 12, Oct 3',
      externalRef: 'web-form-1',
      notesMd: 'Birthday party',
      properties: { contact_email: 'dana@e2e.test', party_size: 12, favourite_colour: 'red' },
      // Not the caller's to say.
      createdBy: 'someone-important@e2e.test',
    });
    expect(response.status(), await response.text()).toBe(201);
    const { card, created } = (await response.json()) as { card: { id: string }; created: boolean };
    expect(created).toBe(true);

    expect(await cardsOn(db, board.id)).toEqual([
      {
        id: card.id,
        title: 'Group of 12, Oct 3',
        column_id: board.columns.new,
        // Fields the board doesn't have are dropped, not stored.
        properties: { contact_email: 'dana@e2e.test', party_size: 12 },
        source: 'intake',
        created_by: 'intake',
        external_ref: 'web-form-1',
        notes_md: 'Birthday party',
      },
    ]);
    const { data: events, error } = await db
      .from('board_events')
      .select('action, actor')
      .eq('card_id', card.id);
    expect(error).toBeNull();
    expect(events).toEqual([{ action: 'created', actor: 'intake' }]);
    // The admins (who hold every board) are told a lead arrived.
    await expect
      .poll(async () => {
        const { data } = await db
          .from('staff_notifications')
          .select('recipient_email')
          .eq('source_id', card.id);
        return (data ?? []).map((n) => n.recipient_email);
      })
      .toContain(ADMIN.email);
  });

  test('a redelivery updates the one card and leaves what staff did alone', async ({
    request,
    db,
  }) => {
    const first = await deliver(request, {
      board: board.slug,
      title: 'Group of 12',
      externalRef: 'web-form-2',
      properties: { contact_email: 'dana@e2e.test', party_size: 12 },
    });
    const { card } = (await first.json()) as { card: { id: string } };
    // Someone has already quoted the lead.
    const moved = await db
      .from('board_cards')
      .update({ column_id: board.columns.quoted })
      .eq('id', card.id);
    expect(moved.error).toBeNull();

    // The sender retries with a corrected party size.
    const again = await deliver(request, {
      board: board.slug,
      title: 'Group of 14',
      externalRef: 'web-form-2',
      properties: { party_size: 14 },
    });
    expect(again.status()).toBe(200);
    expect((await again.json()).created).toBe(false);

    expect(await cardsOn(db, board.id)).toEqual([
      expect.objectContaining({
        id: card.id,
        title: 'Group of 14',
        column_id: board.columns.quoted,
        properties: { contact_email: 'dana@e2e.test', party_size: 14 },
      }),
    ]);
  });

  test('the same submission delivered twice at once makes one card', async ({ request, db }) => {
    const body = { board: board.slug, title: 'Group of 8', externalRef: 'web-form-3' };
    const responses = await Promise.all([deliver(request, body), deliver(request, body)]);
    // One makes the card; the other is answered as the redelivery it is.
    const results = await Promise.all(
      responses.map(async (r) => [r.status(), ((await r.json()) as { created: boolean }).created])
    );
    expect(results.sort()).toEqual([
      [200, false],
      [201, true],
    ]);
    expect(await cardsOn(db, board.id)).toHaveLength(1);
  });

  test('a named column is used, and an unknown one refused', async ({ request, db }) => {
    const quoted = await deliver(request, {
      board: board.slug,
      title: 'Already quoted by phone',
      columnKey: 'quoted',
    });
    expect(quoted.status()).toBe(201);
    const missing = await deliver(request, {
      board: board.slug,
      title: 'Nowhere to go',
      columnKey: 'no_such_column',
    });
    expect(missing.status()).toBe(400);
    expect((await cardsOn(db, board.id)).map((c) => c.column_id)).toEqual([board.columns.quoted]);
  });

  test('refuses a caller without the secret, and boards that are not open to it', async ({
    request,
    db,
  }) => {
    const unsigned = await request.post('/api/boards/intake', {
      data: { board: board.slug, title: 'Spam' },
    });
    expect(unsigned.status()).toBe(401);
    const wrong = await request.post('/api/boards/intake', {
      headers: { authorization: 'Bearer not-the-secret' },
      data: { board: board.slug, title: 'Spam' },
    });
    expect(wrong.status()).toBe(401);

    expect((await deliver(request, { board: 'no-such-board', title: 'Lost' })).status()).toBe(404);
    const archived = await db.from('boards').update({ archived: true }).eq('id', board.id);
    expect(archived.error).toBeNull();
    expect((await deliver(request, { board: board.slug, title: 'Too late' })).status()).toBe(404);
    expect(await cardsOn(db, board.id)).toEqual([]);
  });
});
