import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import QRCode from 'qrcode';

const EC_LEVELS = ['L', 'M', 'Q', 'H'] as const;
type EcLevel = (typeof EC_LEVELS)[number];

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('generate-qr')
    .description('Generate an SVG QR code asset (commit the output next to the post that uses it)')
    .argument('<url>', 'URL the QR code should open when scanned')
    .argument('<outfile>', 'Output .svg path, relative to apps/social/')
    .option('--ec <level>', 'Error correction level (L, M, Q, H). Q or higher for print.', 'Q')
    .parse(process.argv);

  const [url, outfile] = program.args;
  const ec = program.opts<{ ec: string }>().ec.toUpperCase() as EcLevel;
  if (!EC_LEVELS.includes(ec)) {
    throw new Error(`--ec must be one of ${EC_LEVELS.join(', ')} (got ${ec})`);
  }

  // No built-in quiet zone (margin: 0) — the card layout must provide >= 4 modules
  // of clear space around the code (e.g. padding on a white panel).
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: ec,
    margin: 0,
    color: { dark: '#23221c', light: '#0000' },
  });

  const outPath = resolve(import.meta.dirname, '..', outfile);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, svg, 'utf8');
  console.log(`QR for ${url} (EC ${ec}) → ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
