/**
 * Generate PWA icon PNGs from the master SVG.
 * Usage: node scripts/generate-icons.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'icons');
const svgPath = join(iconsDir, 'icon.svg');

const svg = readFileSync(svgPath);
const sizes = [192, 512];

for (const size of sizes) {
  const outPath = join(iconsDir, `icon-${size}.png`);
  await sharp(svg).resize(size, size).png().toFile(outPath);
  console.log(`Generated ${outPath} (${size}x${size})`);
}
