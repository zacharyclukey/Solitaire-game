/**
 * Generates every launcher icon, the maskable variant, the favicon and the
 * splash screen from one vector source, so the whole identity is a single edit.
 *
 *   npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const OUT = 'public/icons';

const INK = '#0c0a1c';
const DEEP = '#1d1848';
const GOLD = '#e3b262';
const CREAM = '#f7f3e9';

/** The mark: a face-down card being turned to reveal a gold spade. */
function mark({ pad = 0 } = {}) {
  const s = 1024;
  const k = 1 - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1636"/>
      <stop offset="1" stop-color="${INK}"/>
    </linearGradient>
    <linearGradient id="back" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#443a86"/>
      <stop offset="1" stop-color="${DEEP}"/>
    </linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#fffdf7"/>
      <stop offset="1" stop-color="${CREAM}"/>
    </linearGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/>
    </filter>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>
  <g transform="translate(${s / 2} ${s / 2}) scale(${k}) translate(${-s / 2} ${-s / 2})">
    <g filter="url(#sh)">
      <g transform="rotate(-16 512 512)">
        <rect x="232" y="222" width="360" height="518" rx="46" fill="url(#back)"/>
        <rect x="266" y="256" width="292" height="450" rx="26" fill="none" stroke="${GOLD}" stroke-opacity="0.34" stroke-width="7"/>
        <circle cx="412" cy="481" r="86" fill="${GOLD}" fill-opacity="0.16"/>
      </g>
      <g transform="rotate(11 512 512)">
        <rect x="446" y="286" width="360" height="518" rx="46" fill="url(#face)"/>
        <path d="M626 386 c62 74 108 118 108 168 0 37-29 62-64 62 -14 0-27-4-38-12 l14 74 -40 0 14-74 c-11 8-24 12-38 12 -35 0-64-25-64-62 0-50 46-94 108-168z" fill="${INK}"/>
      </g>
    </g>
  </g>
</svg>`;
}

const SIZES = [
  { file: 'icon-1024.png', size: 1024 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

await mkdir(OUT, { recursive: true });
const base = Buffer.from(mark());
for (const { file, size } of SIZES) {
  await sharp(base).resize(size, size).png({ compressionLevel: 9 }).toFile(`${OUT}/${file}`);
}
// Maskable: Android crops to a circle, so the mark needs breathing room.
await sharp(Buffer.from(mark({ pad: 0.14 })))
  .resize(512, 512)
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}/icon-512-maskable.png`);

await writeFile(`${OUT}/icon.svg`, mark());

// Splash: the mark centred on the app background, square so it survives any
// orientation crop the native shells apply.
const splash = 2732;
await sharp({
  create: { width: splash, height: splash, channels: 4, background: '#0c0a1c' },
})
  .composite([{ input: await sharp(base).resize(820, 820).png().toBuffer(), gravity: 'centre' }])
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}/splash-2732.png`);

console.log('icons written to', OUT);
