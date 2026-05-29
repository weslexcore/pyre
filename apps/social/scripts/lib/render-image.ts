import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Browser } from 'playwright';
import type { ExportEntry } from './config.ts';
import { SIZES } from './sizes.ts';

export async function renderImage(opts: {
  browser: Browser;
  postUrl: string;
  entry: ExportEntry;
  outPath: string;
  settleMs?: number;
}): Promise<void> {
  const size = SIZES[opts.entry.size];
  const context = await opts.browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.goto(opts.postUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (opts.settleMs) {
      await page.waitForTimeout(opts.settleMs);
    }
    const wantsTransparent = opts.entry.format === 'png' && opts.entry.transparent === true;
    if (wantsTransparent) {
      await page.addStyleTag({
        content: 'html, body, .page, .post, .tpl-menu { background: transparent !important; }',
      });
    }
    await mkdir(dirname(opts.outPath), { recursive: true });
    await page.screenshot({
      path: opts.outPath,
      type: opts.entry.format === 'jpg' ? 'jpeg' : 'png',
      omitBackground: wantsTransparent,
      fullPage: false,
      clip: { x: 0, y: 0, width: size.w, height: size.h },
    });
  } finally {
    await context.close();
  }
}
