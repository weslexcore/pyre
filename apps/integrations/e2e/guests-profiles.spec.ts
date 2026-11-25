// Guest profiles: finding a guest (our profiles plus Momence's members),
// starting a profile with a summary and field answers, notes only their
// author can remove, and the profile fields only a manager can change.

import { DESKTOP_ONLY_TAG, uniqueTag } from '@pyre/e2e-utils';
import { addGuest } from './guests-helpers';
import { MANAGER, STAFF, STAFF_2 } from './roles';
import { clickAndHydrate, expect, open, test } from './test';

test.use({ storageState: STAFF.storageState as string });

test('a guest found by name opens their profile, which saves a summary and answers', async ({
  page,
  db,
  as,
}, testInfo) => {
  const guest = await addGuest(testInfo);
  const fieldLabel = uniqueTag(testInfo, 'Favourite tea');
  const manager = await as(MANAGER);
  const created = await manager.post('/api/admin/guest-fields', {
    data: { label: fieldLabel, kind: 'text' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const field = ((await created.json()) as { field: { key: string } }).field;

  await open(page, '/admin/guests');
  await page.getByPlaceholder('Find a guest by name or email').fill(guest.lastName);
  // A client-side navigation: wait for the profile form to hydrate, or what
  // is typed into it below is lost and the profile saves empty.
  await clickAndHydrate(page.getByRole('link', { name: new RegExp(guest.lastName) }).first());
  await expect(page).toHaveURL(new RegExp(`/admin/guests/${guest.id}`));
  await expect(page.getByText(guest.name).first()).toBeVisible();

  const summary = `Likes it quiet ${guest.lastName}`;
  await page.getByPlaceholder(/Regular on Tuesday evenings/).fill(summary);
  await page.getByLabel(fieldLabel).fill('Hojicha');
  await page.getByRole('button', { name: 'Start profile' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await db
        .from('guest_profiles')
        .select('summary, field_values')
        .eq('momence_member_id', guest.id)
        .maybeSingle();
      return data;
    })
    .toMatchObject({ summary, field_values: { [field.key]: 'Hojicha' } });

  // Leave the field list as it was. It has an answer now, so retire it.
  await manager.patch('/api/admin/guest-fields', { data: { key: field.key, archived: true } });
  await manager.dispose();
});

test('notes on a profile; only their author can remove them', async ({
  page,
  db,
  as,
}, testInfo) => {
  const guest = await addGuest(testInfo);
  // A profile to write on.
  const start = await page.request.post('/api/admin/guests', {
    data: { memberId: guest.id, name: guest.name, email: guest.email, summary: '' },
  });
  expect(start.status(), await start.text()).toBe(201);
  const profileId = ((await start.json()) as { profile: { id: string } }).profile.id;

  await open(page, `/admin/guests/${guest.id}?name=${encodeURIComponent(guest.name)}`);
  const note = `Asked about memberships ${guest.lastName}`;
  await page.getByPlaceholder(/Loved the birch tonight/).fill(note);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText(note)).toBeVisible();
  // The note shows at once; wait for it to be saved.
  let saved: { id: string; author_email: string } | null = null;
  await expect
    .poll(async () => {
      const { data } = await db
        .from('guest_profile_notes')
        .select('id, author_email')
        .eq('profile_id', profileId)
        .maybeSingle();
      saved = data as typeof saved;
      return saved?.author_email;
    })
    .toBe(STAFF.email);

  // Someone else can't remove it.
  const colleague = await as(STAFF_2);
  expect(
    (
      await colleague.delete(`/api/admin/guest-notes?id=${(saved as { id: string } | null)?.id}`)
    ).status()
  ).toBe(403);
  await colleague.dispose();

  // Its author can.
  await page
    .getByRole('listitem')
    .filter({ hasText: note })
    .getByRole('button', { name: 'Remove' })
    .click();
  await page.getByRole('dialog').getByRole('button').last().click();
  await expect(page.getByText(note)).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await db.from('guest_profile_notes').select('id').eq('profile_id', profileId)).data
    )
    .toEqual([]);
});

test.describe('profile fields', () => {
  test('staff are sent away from managing them, and refused by the API', async ({ page }) => {
    await page.goto('/admin/guests/fields');
    await expect(page).toHaveURL(/\/admin\/guests$/);
    const response = await page.request.post('/api/admin/guest-fields', {
      data: { label: 'Not allowed', kind: 'text' },
    });
    expect(response.status()).toBe(403);
  });

  test.describe('a manager', () => {
    test.use({ storageState: MANAGER.storageState as string });

    test(
      'adds a field, which nobody has answered, so can delete it',
      { tag: DESKTOP_ONLY_TAG },
      async ({ page, db }, testInfo) => {
        const label = uniqueTag(testInfo, 'Allergies');
        await open(page, '/admin/guests/fields');
        await page.getByRole('button', { name: 'Add a field' }).click();
        await page.getByPlaceholder('Favourite tea').fill(label);
        // The form opens on "Pick one", which needs options; a text field doesn't.
        await page.getByLabel('Kind').selectOption({ label: 'Short text' });
        await page.getByRole('button', { name: 'Add field' }).click();
        await expect(page.getByText(label).first()).toBeVisible();

        const { data } = await db
          .from('guest_profile_fields')
          .select('key')
          .eq('label', label)
          .single();
        const key = (data as { key: string }).key;
        expect((await page.request.delete(`/api/admin/guest-fields?key=${key}`)).status()).toBe(
          200
        );
        expect((await db.from('guest_profile_fields').select('key').eq('key', key)).data).toEqual(
          []
        );
      }
    );
  });
});
