import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildFixesModule } from './scripts/fixes.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const header = (await readFile('src/header.txt', 'utf8')).replace('{{version}}', version).trimEnd();

const fixes = await buildFixesModule('vendor/dynamic-theme-fixes.config');
const fixesPlugin = {
  name: 'darksafari-fixes',
  setup(b) {
    b.onResolve({ filter: /^darksafari:fixes-data$/ }, () => ({ path: 'fixes-data', namespace: 'darksafari' }));
    b.onLoad({ filter: /.*/, namespace: 'darksafari' }, () => ({ contents: fixes.code, loader: 'js' }));
  },
};

const result = await build({
  plugins: [fixesPlugin],
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'safari15',
  write: false,
  legalComments: 'inline',
  inject: ['src/chrome-shim.ts'],
  define: { chrome: '__darksafariChrome', 'window.chrome': '__darksafariChrome' },
});

await mkdir('dist', { recursive: true });
const banner = `${header}\n\n// DarkSafari v${version} — https://github.com/joewolly/DarkSafari (MIT)\n// Bundles Dark Reader (https://github.com/darkreader/darkreader), MIT License, Copyright (c) Dark Reader Ltd.\n\n`;
await writeFile('dist/darksafari.user.js', banner + result.outputFiles[0].text);
await writeFile('dist/darksafari.meta.js', header + '\n');
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`Built dist/darksafari.user.js (v${version}, ${kb(result.outputFiles[0].text.length + banner.length)}; site fixes: ${fixes.stats.blocks} blocks, ${kb(fixes.stats.bytes)})`);
