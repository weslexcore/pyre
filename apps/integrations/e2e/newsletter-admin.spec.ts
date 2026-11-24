// /admin/newsletters: an admin starts an issue, writes it, sees the preview,
// sends a test, and sends it to the list. Staff without the page can't reach
// the API.

import { allowConsole, DESKTOP_ONLY_TAG, uniqueEmail, uniqueTag } from '@pyre/e2e-utils';
import { ADMIN, STAFF } from './roles';
import { expect, open, test } from './test';
import { type SentEmail, upstreamRequests } from './upstream';

/** A 1x1 PNG, for the uploads. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('an admin', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({
    storageState: ADMIN.storageState as string,
    // The preview frame is sandboxed (a null origin), and the dev server
    // refuses its image requests; a deployment serves them as static files.
    consoleAllowlist: allowConsole(/status of 403 .*\/email\//),
  });

  test('writes, tests and sends a newsletter', async ({ page, db }, testInfo) => {
    const reader = uniqueEmail(testInfo, 'reader');
    await db
      .from('newsletter_subscribers')
      .insert({ email: reader, first_name: 'Rae', lists: ['newsletter'], source: 'e2e' })
      .throwOnError();
    const subject = uniqueTag(testInfo, 'E2E issue');
    const tester = uniqueEmail(testInfo, 'tester');

    await open(page, '/admin/newsletters');
    await page.getByRole('button', { name: 'New newsletter' }).click();
    await expect(page).toHaveURL(/\/admin\/newsletters\/[0-9a-f-]{36}$/);

    await page.getByPlaceholder(/How was your first session/).fill(subject);
    await page
      .getByPlaceholder('Write the paragraph. A blank line starts a new one.')
      .fill('Hello from the e2e newsletter.');
    const preview = page.frameLocator('iframe[title="Newsletter preview"]');
    await expect(preview.getByText('Hello from the e2e newsletter.')).toBeVisible();
    await expect(preview.getByText('Hi there,')).toBeVisible();

    // Their own photo behind the header: uploaded, shown, and in the email.
    await page.getByLabel('Background', { exact: true }).selectOption('own');
    await page.getByLabel('Upload a photo').setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const thumbnail = page.getByRole('img', { name: 'Your background' });
    await expect(thumbnail).toBeVisible();
    const photo = (await thumbnail.getAttribute('src')) as string;
    expect(photo).toMatch(
      /\/storage\/v1\/object\/public\/email-media\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/
    );
    await expect
      .poll(async () => (await page.request.get(photo)).status(), { message: 'served publicly' })
      .toBe(200);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden();

    await page.getByLabel('Send a test to').fill(tester);
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(page.getByText(`Sent to ${tester}`)).toBeVisible();
    const tests = (await upstreamRequests('POST', '/resend/emails'))
      .map((r) => r.body as SentEmail)
      .filter((e) => [e.to].flat().includes(tester));
    expect(tests.map((e) => e.subject)).toEqual([`[TEST] ${subject}`]);

    await page.getByRole('button', { name: 'Send now' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(subject)).toBeVisible();
    await dialog.getByRole('button', { name: /^Send to \d+$/ }).click();
    await expect(page.getByText('Sent', { exact: true })).toBeVisible({ timeout: 60_000 });

    const copies = (await upstreamRequests('POST', '/resend/emails/batch'))
      .flatMap((r) => r.body as SentEmail[])
      .filter((e) => [e.to].flat().includes(reader) && e.subject === subject);
    expect(copies).toHaveLength(1);
    expect(copies[0].html).toContain('Hi Rae,');
    expect(copies[0].html).toContain(`url(${photo})`);

    const id = page.url().split('/').pop();
    const { data } = await db
      .from('newsletters')
      .select('status, created_by')
      .eq('id', id)
      .single();
    expect(data).toEqual({ status: 'sent', created_by: ADMIN.email });
  });
});

test.describe('an email photo upload', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({ storageState: ADMIN.storageState as string });

  test('refuses a format some mail clients cannot show', async ({ request }) => {
    const response = await request.post('/api/admin/email-media', {
      multipart: { file: { name: 'a.webp', mimeType: 'image/webp', buffer: PNG } },
    });
    expect(response.status()).toBe(415);
  });
});

test.describe('staff without the page', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({ storageState: STAFF.storageState as string });

  test('are refused by the API', async ({ request }) => {
    expect((await request.get('/api/admin/newsletters')).status()).toBe(403);
    const upload = await request.post('/api/admin/email-media', {
      multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(upload.status()).toBe(403);
  });
});
