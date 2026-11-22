// מייצר את כל האייקונים ומסכי הפתיחה של האפליקציה מ-SVG אחד.
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });

const mint = '#5CE1A8';
const art = (scale = 1) => `
<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
  <circle cx="512" cy="512" r="318" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="64"/>
  <circle cx="512" cy="512" r="318" fill="none" stroke="${mint}" stroke-width="64" stroke-linecap="round"
    stroke-dasharray="1500 2000" transform="rotate(-100 512 512)"/>
  <g fill="#fff">
    <rect x="352" y="494" width="320" height="36" rx="18"/>
    <rect x="300" y="438" width="52" height="148" rx="20"/>
    <rect x="672" y="438" width="52" height="148" rx="20"/>
    <rect x="258" y="470" width="34" height="84" rx="14"/>
    <rect x="732" y="470" width="34" height="84" rx="14"/>
  </g>
</g>`;

const svg = (scale = 1, rounded = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs><radialGradient id="g" cx="75%" cy="12%" r="90%"><stop offset="0" stop-color="#143a2c"/><stop offset=".55" stop-color="#0a0d12"/><stop offset="1" stop-color="#000"/></radialGradient></defs>
<rect width="1024" height="1024" ${rounded ? 'rx="230"' : ''} fill="url(#g)"/>
${art(scale)}
</svg>`;

writeFileSync('public/icon.svg', svg(1, true));

const png = async (name, size, scale = 1) => {
  await sharp(Buffer.from(svg(scale))).resize(size, size).png().toFile(`public/${name}`);
};
await png('apple-touch-icon.png', 180);
await png('icon-192.png', 192);
await png('icon-512.png', 512);
await png('icon-maskable-512.png', 512, 0.7);

// מסכי פתיחה לאייפון (מונעים הבהוב לבן בעת פתיחת האפליקציה)
const splashes = [
  [1206, 2622], // iPhone 17 / 17 Pro / Air
  [1320, 2868], // iPhone 17 Pro Max / 16 Pro Max
  [1179, 2556], // iPhone 16 / 15 / 14 Pro
  [1290, 2796], // iPhone 15 Plus / 14 Pro Max
  [1170, 2532], // iPhone 14 / 13 / 12
];
for (const [w, h] of splashes) {
  const icon = await sharp(Buffer.from(svg(1, true))).resize(Math.round(w * 0.3)).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: '#000000' } })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(`public/splash-${w}x${h}.png`);
}
console.log('icons ready');
