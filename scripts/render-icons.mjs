// Renders the favicons and home-screen icons for the landing page and the
// integrations admin from the Pyre wave mark SVG, using the Chromium that
// Playwright drives so the edges are anti-aliased at every size.
//
//   node scripts/render-icons.mjs   (needs the playwright package resolvable,
//                                    e.g. after installing apps/social)
//
// iOS fills a transparent apple-touch-icon with black and scales the artwork
// to the full tile, so home-screen icons get a solid brand background with
// the mark at MARK_SCALE of the tile height, centered. Browser-tab favicons
// stay transparent and fill their square so they read at 16-32px.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'apps/landing-page/src/assets/logos/pyre_logo.svg'), 'utf8');

const BLACK = '#23221c'; // --pyre-black
const CREME = '#f5f1e9'; // --pyre-creme
const RED = '#d15232'; // --pyre-red
const GOLD = '#dbb155'; // --pyre-gold
const SAGE = '#839770'; // --pyre-sage

// Home-screen mark height as a share of the tile. 0.56 sits inside iOS's
// rounded corners with room to breathe, close to Apple's own app icons.
const MARK_SCALE = 0.56;
// Android masks maskable icons to a circle of 80% diameter; keep the mark
// well inside it.
const MASKABLE_SCALE = 0.5;

const landing = (p) => join(root, 'apps/landing-page/public', p);
const admin = (p) => join(root, 'apps/integrations/public', p);

const icons = [
  // Landing page
  { out: landing('favicon.png'), size: 32, color: RED },
  { out: landing('favicon-16.png'), size: 16, color: RED, temp: true },
  { out: landing('favicon-48.png'), size: 48, color: RED, temp: true },
  { out: landing('apple-touch-icon.png'), size: 180, color: RED, bg: CREME, scale: MARK_SCALE },
  // Integrations admin
  { out: admin('favicon.png'), size: 32, color: GOLD },
  { out: admin('favicon-staging.png'), size: 32, color: SAGE },
  { out: admin('apple-touch-icon.png'), size: 180, color: GOLD, bg: BLACK, scale: MARK_SCALE },
  { out: admin('icons/icon-192.png'), size: 192, color: GOLD, bg: BLACK, scale: MARK_SCALE },
  { out: admin('icons/icon-512.png'), size: 512, color: GOLD, bg: BLACK, scale: MARK_SCALE },
  { out: admin('icons/icon-maskable-192.png'), size: 192, color: GOLD, bg: BLACK, scale: MASKABLE_SCALE },
  { out: admin('icons/icon-maskable-512.png'), size: 512, color: GOLD, bg: BLACK, scale: MASKABLE_SCALE },
];

const html = ({ size, color, bg, scale = 1 }) => `<!doctype html>
<style>
  html, body { margin: 0; background: ${bg ?? 'transparent'}; }
  body { width: ${size}px; height: ${size}px; display: grid; place-items: center; }
  svg { height: ${scale * 100}%; width: auto; max-width: 100%; display: block; }
</style>
${svg.replace(/<\?xml[^>]*>/, '').replace(/currentColor/g, color)}`;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: '/opt/pw-browsers/chromium' },
);
const page = await browser.newPage({ deviceScaleFactor: 1 });
const rendered = new Map();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(html(icon));
  const png = await page.screenshot({ omitBackground: !icon.bg });
  rendered.set(icon.out, png);
  if (!icon.temp) writeFileSync(icon.out, png);
  console.log(`${icon.temp ? '(ico) ' : ''}${icon.out.slice(root.length + 1)}`);
}
await browser.close();

// favicon.ico: 16, 32 and 48px PNGs in one ICO container (PNG-in-ICO is
// supported by every browser that still asks for /favicon.ico).
const entries = [landing('favicon-16.png'), landing('favicon.png'), landing('favicon-48.png')].map((p) => rendered.get(p));
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach((png, i) => {
  const size = png.readUInt32BE(16); // IHDR width
  const at = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, at);
  header.writeUInt8(size >= 256 ? 0 : size, at + 1);
  header.writeUInt16LE(1, at + 4); // color planes
  header.writeUInt16LE(32, at + 6); // bits per pixel
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(landing('favicon.ico'), Buffer.concat([header, ...entries]));
console.log('apps/landing-page/public/favicon.ico');
