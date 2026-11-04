// Generates the installable-app icons from the brand mark (src/components/brand.tsx LogoMark).
// Run after changing the mark: `node scripts/make-icons.mjs`. Output is committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

// Brand tokens (globals.css) as hex: brand, brand-foreground, and the app background (themeColor).
const BRAND = "#b7f652";
const INK = "#0e1a07";
const BG = "#0e1220";

/** The ticket mark on a full-bleed navy square. `scale` = share of the canvas the mark spans. */
function svg(size, scale) {
  const mark = 32; // LogoMark viewBox
  const s = (size * scale) / mark;
  const offset = (size - mark * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${s})">
    <path fill="${BRAND}" d="M7 3h18a3 3 0 0 1 3 3v6.5a3.5 3.5 0 0 0 0 7V26a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6.5a3.5 3.5 0 0 0 0-7V6a3 3 0 0 1 3-3Z"/>
    <path stroke="${INK}" stroke-width="2.6" stroke-linecap="round" d="M10 10.5h12M10 16h8M10 21.5h10"/>
  </g>
</svg>`;
}

const out = [
  // "any" icons: the mark fills most of the tile.
  ["public/icons/icon-192.png", 192, 0.7],
  ["public/icons/icon-512.png", 512, 0.7],
  // Maskable: Android may crop to a circle, so keep the mark inside the 80% safe zone.
  ["public/icons/maskable-512.png", 512, 0.52],
  // iOS home screen (iOS rounds the corners itself).
  ["public/icons/apple-touch-icon.png", 180, 0.66],
  // Browser tab favicon.
  ["src/app/icon.png", 64, 0.8],
];

await mkdir("public/icons", { recursive: true });
for (const [file, size, scale] of out) {
  await sharp(Buffer.from(svg(size, scale))).png().toFile(file);
  console.log("wrote", file);
}
