// Generates the installable-app icons from the brand mark (src/components/brand.tsx LogoMark).
// Run after changing the mark: `node scripts/make-icons.mjs`. Output is committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

// Brand tokens (globals.css) as hex: ink (foreground), hype (coral), and the paper background (themeColor).
const INK = "#181a21";
const HYPE = "#e2553a";
const BG = "#fbfaf7";
// Keep in sync with LOGO_S / LOGO_SLASH in src/components/brand.tsx.
const S = "M18.6 10.6c-1-1.8-3-2.8-5.5-2.8-3.1 0-5.4 1.7-5.4 4 0 5.7 11.4 3.1 11.4 8.7 0 2.5-2.4 4.2-5.8 4.2-2.6 0-4.7-1.1-5.8-3";
const SLASH = "M21.8 25.2 26.4 7.6";

/** The mark (ink s + coral slash) on a full-bleed paper square. `scale` = share of the canvas the mark spans. */
function svg(size, scale) {
  const mark = 32; // LogoMark viewBox
  const s = (size * scale) / mark;
  const offset = (size - mark * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${s})">
    <path d="${S}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="${SLASH}" fill="none" stroke="${HYPE}" stroke-width="3.6" stroke-linecap="round"/>
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
