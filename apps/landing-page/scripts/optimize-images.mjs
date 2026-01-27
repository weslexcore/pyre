#!/usr/bin/env node
/**
 * Image Optimization Script
 *
 * Optimizes images in src/assets/images/ and src/assets/backgrounds/
 * - Converts large photos (JPG/PNG) to WebP
 * - Resizes oversized images to max width
 * - Compresses remaining images
 *
 * Usage: node scripts/optimize-images.mjs [--dry-run]
 */

import sharp from 'sharp';
import { readdir, stat, mkdir, rename, unlink } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Configuration
const CONFIG = {
  // Directories to process
  imageDirs: [
    join(rootDir, 'src/assets/images'),
    join(rootDir, 'src/assets/backgrounds'),
  ],

  // Max dimensions
  maxWidth: {
    hero: 2000,      // Hero images
    default: 1600,   // Regular images
    thumbnail: 800,  // Small images
  },

  // Quality settings
  quality: {
    webp: 85,
    jpeg: 85,
    png: 85,  // PNG compression level for pngquant
  },

  // Target file sizes (KB) - for reporting
  targetSizes: {
    hero: 300,
    content: 150,
    thumbnail: 50,
    pattern: 200,
  },

  // Files that should stay as PNG (patterns, graphics with transparency)
  keepAsPng: [
    'tiled',
    'pattern',
    'logo',
    'icon',
    'symbol',
  ],

  // Hero images that get larger max width
  heroImages: [
    'hero',
    'bucket_with_red_flowers',
  ],
};

// Stats tracking
const stats = {
  processed: 0,
  skipped: 0,
  errors: 0,
  totalSavedBytes: 0,
  files: [],
};

const isDryRun = process.argv.includes('--dry-run');

/**
 * Get all image files recursively from a directory
 */
async function getImageFiles(dir) {
  const files = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await getImageFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.jpg', '.jpeg', '.png'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err.message);
  }

  return files;
}

/**
 * Determine if file should be converted to WebP
 */
function shouldConvertToWebP(filePath) {
  const name = basename(filePath).toLowerCase();

  // Keep PNGs that match keepAsPng patterns
  for (const pattern of CONFIG.keepAsPng) {
    if (name.includes(pattern)) {
      return false;
    }
  }

  return true;
}

/**
 * Get max width for an image based on its name
 */
function getMaxWidth(filePath) {
  const name = basename(filePath).toLowerCase();

  for (const heroName of CONFIG.heroImages) {
    if (name.includes(heroName)) {
      return CONFIG.maxWidth.hero;
    }
  }

  return CONFIG.maxWidth.default;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Process a single image file
 */
async function processImage(filePath) {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const originalStats = await stat(filePath);
  const originalSize = originalStats.size;

  console.log(`\nProcessing: ${filePath.replace(rootDir, '')}`);
  console.log(`  Original: ${formatBytes(originalSize)}`);

  try {
    // Load image and get metadata
    const image = sharp(filePath);
    const metadata = await image.metadata();

    const maxWidth = getMaxWidth(filePath);
    const needsResize = metadata.width > maxWidth;
    const convertToWebP = shouldConvertToWebP(filePath);

    // Build the sharp pipeline
    let pipeline = sharp(filePath);

    // Resize if needed
    if (needsResize) {
      console.log(`  Resizing: ${metadata.width}px -> ${maxWidth}px`);
      pipeline = pipeline.resize(maxWidth, null, {
        withoutEnlargement: true,
        fit: 'inside',
      });
    }

    // Determine output format and path
    let outputPath = filePath;
    let outputBuffer;

    if (convertToWebP) {
      // Convert to WebP
      outputBuffer = await pipeline
        .webp({ quality: CONFIG.quality.webp })
        .toBuffer();

      // Change extension to .webp
      outputPath = filePath.replace(/\.(jpg|jpeg|png)$/i, '.webp');
      console.log(`  Converting to WebP`);
    } else if (ext === '.png') {
      // Optimize PNG
      outputBuffer = await pipeline
        .png({
          compressionLevel: 9,
          palette: true,
          quality: CONFIG.quality.png,
        })
        .toBuffer();
    } else {
      // Optimize JPEG
      outputBuffer = await pipeline
        .jpeg({ quality: CONFIG.quality.jpeg })
        .toBuffer();
    }

    const newSize = outputBuffer.length;
    const savedBytes = originalSize - newSize;
    const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);

    console.log(`  Optimized: ${formatBytes(newSize)} (saved ${formatBytes(savedBytes)}, ${savedPercent}%)`);

    if (!isDryRun) {
      // Write the optimized file
      await sharp(outputBuffer).toFile(outputPath);

      // If we converted to WebP, delete the original
      if (convertToWebP && outputPath !== filePath) {
        await unlink(filePath);
        console.log(`  Deleted original: ${name}`);
      }
    } else {
      console.log(`  [DRY RUN] Would write to: ${outputPath.replace(rootDir, '')}`);
    }

    stats.processed++;
    stats.totalSavedBytes += Math.max(0, savedBytes);
    stats.files.push({
      original: filePath.replace(rootDir, ''),
      output: outputPath.replace(rootDir, ''),
      originalSize,
      newSize,
      savedBytes,
      savedPercent: parseFloat(savedPercent),
    });

  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Image Optimization Script');
  console.log('='.repeat(60));

  if (isDryRun) {
    console.log('\n*** DRY RUN MODE - No files will be modified ***\n');
  }

  // Collect all image files
  const allFiles = [];
  for (const dir of CONFIG.imageDirs) {
    const files = await getImageFiles(dir);
    allFiles.push(...files);
  }

  console.log(`Found ${allFiles.length} images to process\n`);

  // Sort by size (largest first) for visibility
  const filesWithStats = await Promise.all(
    allFiles.map(async (f) => {
      const s = await stat(f);
      return { path: f, size: s.size };
    })
  );
  filesWithStats.sort((a, b) => b.size - a.size);

  // Process each file
  for (const { path } of filesWithStats) {
    await processImage(path);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Processed: ${stats.processed} files`);
  console.log(`Skipped: ${stats.skipped} files`);
  console.log(`Errors: ${stats.errors} files`);
  console.log(`Total saved: ${formatBytes(stats.totalSavedBytes)}`);

  if (stats.files.length > 0) {
    console.log('\nTop savings:');
    const topSavings = [...stats.files]
      .sort((a, b) => b.savedBytes - a.savedBytes)
      .slice(0, 10);

    for (const file of topSavings) {
      console.log(`  ${file.original}: ${formatBytes(file.savedBytes)} (${file.savedPercent}%)`);
    }
  }

  if (isDryRun) {
    console.log('\n*** DRY RUN COMPLETE - Run without --dry-run to apply changes ***');
  }
}

main().catch(console.error);
