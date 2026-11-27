// /admin/newsletters: an admin starts an issue, writes it, sees the preview,
// sends a test, and sends it to the list. Staff without the page can't reach
// the API.

import { allowConsole, DESKTOP_ONLY_TAG, uniqueEmail, uniqueTag } from '@pyre/e2e-utils';
import { EMAIL_MEDIA_MAX_BYTES } from '../src/lib/email/media';
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
    // The greeting (the first block) centered.
    await page.getByRole('button', { name: 'Center', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Center', exact: true }).first()).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    // A gold divider under the text.
    await page.getByRole('button', { name: '+ Divider' }).click();
    await page.getByTitle('Gold').last().click();
    await expect(page.getByRole('radio', { name: 'Gold' }).last()).toBeChecked();
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

    // Their own logo in the header, in place of Pyre's.
    await page.getByLabel('Logo', { exact: true }).selectOption('own');
    await page.getByLabel('Upload a logo').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const logo = (await page.getByRole('img', { name: 'Your logo' }).getAttribute('src')) as string;
    expect(logo).toMatch(/\/email-media\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/);

    // It saves itself.
    await expect(page.getByText('All changes saved')).toBeVisible();

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
    expect(copies[0].html).toMatch(/<hr[^>]*style="[^"]*#dbb155/);
    expect(copies[0].html).toMatch(/<p[^>]*style="[^"]*text-align:center[^"]*"[^>]*>Hi Rae,/);
    expect(copies[0].html).toContain(`url(${photo})`);
    expect(copies[0].html).toContain(`src="${logo}"`);
    expect(copies[0].html).not.toContain('logo-header-creme.png');

    const id = page.url().split('/').pop();
    const { data } = await db
      .from('newsletters')
      .select('status, created_by')
      .eq('id', id)
      .single();
    expect(data).toEqual({ status: 'sent', created_by: ADMIN.email });
  });
});

test.describe('a newsletter draft', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({
    storageState: ADMIN.storageState as string,
    consoleAllowlist: allowConsole(/status of 403 .*\/email\//, /status of 400/),
  });

  test('is still there after leaving the page', async ({ page, db }, testInfo) => {
    const subject = uniqueTag(testInfo, 'E2E draft');
    await open(page, '/admin/newsletters');
    await page.getByRole('button', { name: 'New newsletter' }).click();
    await expect(page).toHaveURL(/\/admin\/newsletters\/[0-9a-f-]{36}$/);
    const editor = page.url();
    const id = editor.split('/').pop();

    // Saved to the server as it is typed.
    await page.getByPlaceholder(/How was your first session/).fill(subject);
    await page.getByLabel('Logo', { exact: true }).selectOption('none');
    await expect(page.getByText('All changes saved')).toBeVisible();
    const { data } = await db.from('newsletters').select('content').eq('id', id).single();
    expect(data?.content).toMatchObject({ subject, logo: 'none' });

    await open(page, '/admin/newsletters');
    await open(page, editor);
    await expect(page.getByPlaceholder(/How was your first session/)).toHaveValue(subject);
    await expect(page.getByLabel('Logo', { exact: true })).toHaveValue('none');

    // A change the server refuses (no subject) is kept in the browser.
    await page.getByPlaceholder(/How was your first session/).fill('');
    await page
      .getByPlaceholder('Write the paragraph. A blank line starts a new one.')
      .fill('Kept while the subject is empty.');
    await expect(page.getByText(/Not saved: The email needs a subject line/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Picked up the changes you hadn't saved yet")).toBeVisible();
    await expect(
      page.getByPlaceholder('Write the paragraph. A blank line starts a new one.')
    ).toHaveValue('Kept while the subject is empty.');

    await page.getByRole('button', { name: 'Discard them' }).click();
    await expect(page.getByPlaceholder(/How was your first session/)).toHaveValue(subject);
    await expect(page.getByText('All changes saved')).toBeVisible();
  });
});

test.describe('an email photo upload', { tag: DESKTOP_ONLY_TAG }, () => {
  test.use({
    storageState: ADMIN.storageState as string,
    // The new issue's preview loads the header logo and badges; see 'an admin'.
    consoleAllowlist: allowConsole(/status of 403 .*\/email\//),
  });

  test('shrinks a big photo before it uploads', async ({ page }) => {
    await open(page, '/admin/newsletters');
    await page.getByRole('button', { name: 'New newsletter' }).click();
    await expect(page).toHaveURL(/\/admin\/newsletters\/[0-9a-f-]{36}$/);
    await page.getByLabel('Background', { exact: true }).selectOption('own');

    // A 3000px photo of random noise, which PNG can't compress: about 20 MB,
    // and still several MB once scaled to 1600px, so it has to go out as a JPEG.
    const upload = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().endsWith('/api/admin/email-media')
    );
    const sourceBytes = await page
      .getByLabel('Upload a photo')
      .evaluate(async (input: HTMLInputElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = 3000;
        canvas.height = 2000;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const pixels = ctx.createImageData(3000, 2000);
        let seed = 1;
        for (let i = 0; i < pixels.data.length; i++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          pixels.data[i] = i % 4 === 3 ? 255 : seed & 255;
        }
        ctx.putImageData(pixels, 0, 0);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b as Blob), 'image/png')
        );
        const files = new DataTransfer();
        files.items.add(new File([blob], 'huge.png', { type: 'image/png' }));
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return blob.size;
      });
    // Otherwise the test proves nothing about the limit.
    expect(sourceBytes).toBeGreaterThan(EMAIL_MEDIA_MAX_BYTES);

    // What reaches the server is a JPEG under the limit, not the original.
    const sent = (await upload).postDataBuffer();
    expect(sent?.length ?? Infinity).toBeLessThan(EMAIL_MEDIA_MAX_BYTES);
    expect(sent?.toString('latin1')).toMatch(
      /filename="huge\.jpg"\r\nContent-Type: image\/jpeg/
    );

    const thumbnail = page.getByRole('img', { name: 'Your background' });
    await expect(thumbnail).toBeVisible({ timeout: 30_000 });
    const width = await thumbnail.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return img.naturalWidth;
    });
    expect(width).toBe(1600);
  });

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
