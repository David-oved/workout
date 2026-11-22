import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const notes: Record<string, string[]> = JSON.parse(readFileSync('./release-notes.json', 'utf8'));

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const buildId = `${stamp}-${(process.env.GITHUB_SHA || 'local').slice(0, 7)}`;
const BASE = '/workout/';

/** כותב version.json לשורש האתר. האפליקציה בודקת אותו תמיד מהשרת, בלי מטמון. */
function versionJson(): Plugin {
  return {
    name: 'workout-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(
          { version: pkg.version, buildId, builtAt: new Date().toISOString(), notes: notes[pkg.version] ?? [] },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: { target: 'es2022', sourcemap: false },
  plugins: [
    preact(),
    versionJson(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'workOut',
        short_name: 'workOut',
        description: 'מעקב תזונה ואימונים אישי למאסה',
        id: BASE,
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
    }),
  ],
});
