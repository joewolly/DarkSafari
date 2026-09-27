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
  minify: true,
  legalComments: 'inline',
  inject: ['src/chrome-shim.ts'],
  define: { chrome: '__darksafariChrome', 'window.chrome': '__darksafariChrome' },
});

// esbuild puts "use strict" at the very top. Some Userscripts versions run the script as
// the body of Function('{GM,GM_info}', code), and a function with a destructured
// parameter can't start with "use strict", so Safari refuses to run the script at all.
// Move the directive inside the bundle's own function, where it's allowed.
const STRICT_IIFE = '"use strict";(()=>{';
let bundle = result.outputFiles[0].text;
if (!bundle.startsWith(STRICT_IIFE)) throw new Error(`Unexpected bundle start: ${bundle.slice(0, 40)}`);
bundle = '(()=>{"use strict";' + bundle.slice(STRICT_IIFE.length);

await mkdir('dist', { recursive: true });
const banner = `${header}\n\n// DarkSafari v${version} — https://github.com/joewolly/DarkSafari (MIT)\n// Bundles Dark Reader (https://github.com/darkreader/darkreader), MIT License, Copyright (c) Dark Reader Ltd.\n\n`;
await writeFile('dist/darksafari.user.js', banner + bundle);
await writeFile('dist/darksafari.meta.js', header + '\n');
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`Built dist/darksafari.user.js (v${version}, ${kb(bundle.length + banner.length)}; site fixes: ${fixes.stats.blocks} blocks, ${kb(fixes.stats.bytes)})`);
