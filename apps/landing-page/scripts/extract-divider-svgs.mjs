#!/usr/bin/env node
/**
 * SVG-to-PNG Extraction Script for Email Dividers
 *
 * Parses SectionDivider.astro to extract all SVG variant paths,
 * then generates standalone .svg and .png files in every brand
 * color and gradient combination.
 *
 * Usage:
 *   node scripts/extract-divider-svgs.mjs [options]
 *
 * Options:
 *   --dry-run        Parse and report without writing files
 *   --flipped        Also generate flipped (vertically mirrored) variants
 *   --color=<name>   Generate only a specific color/gradient
 */

import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const COLORS = {
  creme: { type: 'solid', hex: '#f5f1e9' },
  black: { type: 'solid', hex: '#23221c' },
  red: { type: 'solid', hex: '#d15232' },
  blue: { type: 'solid', hex: '#274868' },
  gold: { type: 'solid', hex: '#dbb155' },
  'muted-gold': { type: 'solid', hex: '#cda56a' },
  sage: { type: 'solid', hex: '#839770' },
  sky: { type: 'solid', hex: '#3991b7' },
  rainbow: {
    type: 'gradient',
    stops: [
      { offset: '0%', color: '#d15232' },
      { offset: '20%', color: '#dbb155' },
      { offset: '40%', color: '#839770' },
      { offset: '60%', color: '#3991b7' },
      { offset: '80%', color: '#274868' },
      { offset: '100%', color: '#d15232' },
    ],
  },
  'red-gold': {
    type: 'gradient',
    stops: [
      { offset: '0%', color: '#d15232' },
      { offset: '100%', color: '#dbb155' },
    ],
  },
  'blue-red': {
    type: 'gradient',
    stops: [
      { offset: '0%', color: '#274868' },
      { offset: '100%', color: '#d15232' },
    ],
  },
};

const STROKE_WIDTH = 20;
const SVG_WIDTH = 1200;
const SVG_HEIGHT = 60;
const PNG_SCALE = 2; // 2x density → 2400×120

// Variants to skip (won't be exported)
const SKIP_VARIANTS = new Set(['scallop']);

const COMPONENT_PATH = join(
  rootDir,
  'src/components/SectionDivider.astro',
);
const OUTPUT_DIR = join(rootDir, 'public/svg');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const includeFlipped = args.includes('--flipped');
const colorFlag = args.find((a) => a.startsWith('--color='));
const onlyColor = colorFlag ? colorFlag.split('=')[1] : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parse SectionDivider.astro and extract variant name → SVG inner content
 * (the <path> element with its attributes).
 *
 * We look for blocks matching the pattern:
 *   {variant === '<name>' && (
 *     <svg ...>
 *       <path d="..." ... />
 *     </svg>
 *   )}
 */
function parseVariants(source) {
  const variants = new Map();

  // Match each variant block — captures variant name and the <path .../> element
  const variantRegex =
    /variant\s*===\s*'(\w+)'\s*&&\s*\(\s*<svg[^>]*>([\s\S]*?)<\/svg>/g;

  let match;
  while ((match = variantRegex.exec(source)) !== null) {
    const name = match[1];
    const inner = match[2].trim();

    // Extract path attributes from the inner content
    const pathMatch = inner.match(/<path\s+([\s\S]*?)\/>/);
    if (!pathMatch) continue;

    const attrString = pathMatch[1];

    // Extract the d attribute
    const dMatch = attrString.match(/d="([^"]+)"/);
    if (!dMatch) continue;

    // Check for stroke-linejoin
    const linejoinMatch = attrString.match(/stroke-linejoin="([^"]+)"/);

    if (SKIP_VARIANTS.has(name)) continue;

    variants.set(name, {
      d: dMatch[1],
      strokeLinejoin: linejoinMatch ? linejoinMatch[1] : null,
    });
  }

  return variants;
}

/**
 * Build a standalone SVG string for a given variant + color config.
 */
function buildSvg(variant, colorConfig, flipped = false) {
  const { d, strokeLinejoin } = variant;

  let defs = '';
  let strokeAttr;

  if (colorConfig.type === 'solid') {
    strokeAttr = `stroke="${colorConfig.hex}"`;
  } else {
    // Build gradient defs
    const stops = colorConfig.stops
      .map((s) => `      <stop offset="${s.offset}" stop-color="${s.color}"/>`)
      .join('\n');
    defs = `  <defs>\n    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">\n${stops}\n    </linearGradient>\n  </defs>\n`;
    strokeAttr = 'stroke="url(#grad)"';
  }

  const linejoinAttr = strokeLinejoin
    ? ` stroke-linejoin="${strokeLinejoin}"`
    : '';

  const transform = flipped
    ? ` transform="scale(1,-1) translate(0,-${SVG_HEIGHT})"`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" fill="none">
${defs}  <path d="${d}" ${strokeAttr} stroke-width="${STROKE_WIDTH}" stroke-linecap="round"${linejoinAttr}${transform}/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const stats = {
  variants: 0,
  colors: 0,
  svgFiles: 0,
  pngFiles: 0,
  totalBytes: 0,
  errors: 0,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('SVG/PNG Divider Extraction');
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('\n*** DRY RUN MODE — No files will be written ***\n');
  }
  if (onlyColor) {
    if (!COLORS[onlyColor]) {
      console.error(`Unknown color: "${onlyColor}"`);
      console.error(`Available: ${Object.keys(COLORS).join(', ')}`);
      process.exit(1);
    }
    console.log(`Generating only: ${onlyColor}\n`);
  }
  if (includeFlipped) {
    console.log('Including flipped variants\n');
  }

  // 1. Parse the component
  const source = await readFile(COMPONENT_PATH, 'utf-8');
  const variants = parseVariants(source);

  if (variants.size === 0) {
    console.error('No variants found in SectionDivider.astro');
    process.exit(1);
  }

  stats.variants = variants.size;
  console.log(`Found ${variants.size} variants: ${[...variants.keys()].join(', ')}`);

  // 2. Determine which colors to generate
  const colorEntries = onlyColor
    ? [[onlyColor, COLORS[onlyColor]]]
    : Object.entries(COLORS);

  stats.colors = colorEntries.length;
  console.log(`Colors/gradients: ${colorEntries.length}`);

  const suffixes = [''];
  if (includeFlipped) suffixes.push('-flipped');

  const totalFiles =
    variants.size * colorEntries.length * suffixes.length * 2; // ×2 for svg+png
  console.log(`Expected output: ${totalFiles} files\n`);

  // 3. Generate files
  for (const [colorName, colorConfig] of colorEntries) {
    const colorDir = join(OUTPUT_DIR, colorName);

    if (!isDryRun) {
      await mkdir(colorDir, { recursive: true });
    }

    for (const [variantName, variantData] of variants) {
      for (const suffix of suffixes) {
        const flipped = suffix === '-flipped';
        const baseName = `divider-${variantName}${suffix}`;
        const svgPath = join(colorDir, `${baseName}.svg`);
        const pngPath = join(colorDir, `${baseName}.png`);

        const svgContent = buildSvg(variantData, colorConfig, flipped);
        const svgBuffer = Buffer.from(svgContent, 'utf-8');

        if (isDryRun) {
          console.log(
            `  [DRY] ${colorName}/${baseName}.svg (${formatBytes(svgBuffer.length)})`,
          );
          console.log(
            `  [DRY] ${colorName}/${baseName}.png (${SVG_WIDTH * PNG_SCALE}×${SVG_HEIGHT * PNG_SCALE}px)`,
          );
          stats.svgFiles++;
          stats.pngFiles++;
          continue;
        }

        try {
          // Write SVG
          await writeFile(svgPath, svgContent, 'utf-8');
          stats.svgFiles++;
          stats.totalBytes += svgBuffer.length;

          // Convert to PNG at 2× density
          const pngBuffer = await sharp(svgBuffer, { density: 72 * PNG_SCALE })
            .resize(SVG_WIDTH * PNG_SCALE, SVG_HEIGHT * PNG_SCALE)
            .png()
            .toBuffer();

          await writeFile(pngPath, pngBuffer);
          stats.pngFiles++;
          stats.totalBytes += pngBuffer.length;

          console.log(
            `  ✓ ${colorName}/${baseName} — svg ${formatBytes(svgBuffer.length)}, png ${formatBytes(pngBuffer.length)}`,
          );
        } catch (err) {
          console.error(`  ✗ ${colorName}/${baseName}: ${err.message}`);
          stats.errors++;
        }
      }
    }
  }

  // 4. Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Variants parsed:  ${stats.variants}`);
  console.log(`Colors/gradients: ${stats.colors}`);
  console.log(`SVG files:        ${stats.svgFiles}`);
  console.log(`PNG files:        ${stats.pngFiles}`);
  console.log(`Total files:      ${stats.svgFiles + stats.pngFiles}`);
  if (!isDryRun) {
    console.log(`Total size:       ${formatBytes(stats.totalBytes)}`);
  }
  if (stats.errors > 0) {
    console.log(`Errors:           ${stats.errors}`);
  }
  console.log(`Output directory: ${OUTPUT_DIR.replace(rootDir, '.')}`);

  if (isDryRun) {
    console.log(
      '\n*** DRY RUN COMPLETE — Run without --dry-run to write files ***',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
