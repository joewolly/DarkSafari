import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const header = (await readFile('src/header.txt', 'utf8')).replace('{{version}}', version).trimEnd();

const result = await build({
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
console.log(`Built dist/darksafari.user.js (v${version})`);
