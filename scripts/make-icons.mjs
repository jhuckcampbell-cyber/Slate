// Generates the installable-app icons from the brand mark (src/components/brand.tsx LogoMark).
// Run after changing the mark: `node scripts/make-icons.mjs`. Output is committed.
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

// Brand tokens (globals.css) as hex: brand (violet), hype (coral), and the app background (themeColor).
const BRAND = "#8b5cf6";
const HYPE = "#fb7158";
const BG = "#0e1220";
// Keep in sync with LOGO_S in src/components/brand.tsx.
const S = "M21.6 10.6c-1-1.8-3-2.8-5.5-2.8-3.1 0-5.4 1.7-5.4 4 0 5.7 11.4 3.1 11.4 8.7 0 2.5-2.4 4.2-5.8 4.2-2.6 0-4.7-1.1-5.8-3";

/** The mark on a full-bleed navy square. `scale` = share of the canvas the mark spans. */
function svg(size, scale) {
  const mark = 32; // LogoMark viewBox
  const s = (size * scale) / mark;
  const offset = (size - mark * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND}"/><stop offset="1" stop-color="${HYPE}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${s})">
    <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#g)"/>
    <path d="${S}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="24.8" cy="7.4" r="1.7" fill="#fff"/>
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
