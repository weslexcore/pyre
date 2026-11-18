// Public board forms (/forms/{board}): anyone with the link can send one, and
// it becomes a card on the board. Each test seeds its own board.

import { allowConsole, DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, open, test } from './test';

const TITLE_QUESTION = { kind: 'builtin', key: 'title', label: null, hint: null, required: true };

async function seedForm(
  db: SupabaseClient,
  form: { enabled?: boolean; access?: 'public' | 'admin' } = {}
): Promise<{ slug: string; boardId: string }> {
  const slug = `e2e-${Math.random().toString(36).slice(2, 10)}`;
  const { data: board, error } = await db
    .from('boards')
    .insert({ slug, name: `E2E ${slug}`, card_noun: 'request', include_in_all_tasks: false })
    .select('id')
    .single();
  expect(error).toBeNull();
  const boardId = (board as { id: string }).id;
  expect(
    (
      await db
        .from('board_columns')
        .insert({ board_id: boardId, key: 'new', label: 'New', kind: 'open' })
    ).error
  ).toBeNull();
  expect(
    (
      await db.from('board_forms').insert({
        board_id: boardId,
        enabled: form.enabled ?? true,
        access: form.access ?? 'public',
        title: `E2E ${slug}`,
        confirmation: 'Thanks, we have it.',
        submit_label: 'Send',
        questions: [TITLE_QUESTION],
      })
    ).error
  ).toBeNull();
  return { slug, boardId };
}

test('a submission becomes a card', async ({ page, db }) => {
  const { slug, boardId } = await seedForm(db);
  const title = `Broken towel hook ${slug}`;

  await open(page, `/forms/${slug}`);
  await page.getByLabel('Title').fill(title);
  // The form refuses anything sent within 3s of opening it (lib/boards/form-guard).
  await page.waitForTimeout(3_100);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thanks, we have it.')).toBeVisible();

  const { data } = await db
    .from('board_cards')
    .select('title, source, created_by')
    .eq('board_id', boardId)
    .single();
  expect(data).toEqual({ title, source: 'form', created_by: 'form' });
});

test.describe('a closed form', () => {
  test.use({ consoleAllowlist: allowConsole(/status of 410/) });

  test('says so', async ({ page, db }) => {
    const { slug } = await seedForm(db, { enabled: false });
    const response = await page.goto(`/forms/${slug}`);
    expect(response?.status()).toBe(410);
    await expect(page.getByText('This form is closed.')).toBeVisible();
  });
});

test('a staff-only form sends visitors to sign in', async ({ page, db }) => {
  const { slug } = await seedForm(db, { access: 'admin' });
  await page.goto(`/forms/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/\\?returnUrl=%2Fforms%2F${slug}$`));
});

test.describe('the submit API', { tag: DESKTOP_ONLY_TAG }, () => {
  test('quietly drops a bot that fills the hidden field', async ({ request, db }) => {
    const { slug, boardId } = await seedForm(db);
    const response = await request.post(`/api/forms/${slug}`, {
      data: { answers: { title: 'spam' }, startedAt: Date.now() - 60_000, website: 'http://spam' },
    });
    expect(response.status()).toBe(200);
    const { count } = await db
      .from('board_cards')
      .select('id', { count: 'exact', head: true })
      .eq('board_id', boardId);
    expect(count).toBe(0);
  });

  test('refuses a form sent too fast', async ({ request, db }) => {
    const { slug } = await seedForm(db);
    const response = await request.post(`/api/forms/${slug}`, {
      data: { answers: { title: 'hurried' }, startedAt: Date.now() },
    });
    expect(response.status()).toBe(400);
  });
});
