/**
 * Turns Dark Reader's dynamic-theme-fixes.config into a compact module:
 *   COMMON – the "*" fix that applies to every site (JSON string)
 *   PACKED – base64 of the deflate-raw compressed JSON [DATA, OFFSETS, INDEX]:
 *     DATA    – every site fix back to back; DATA.slice(OFFSETS[i], OFFSETS[i + 1]) is block i
 *     INDEX   – "\nhost\t1,2,3\n..." lookup text, searched with indexOf (no parsing)
 *   WILD   – blocks whose patterns can't be keyed by host (regexps, "google.*")
 * Only the handful of blocks that match a page are parsed. The fixes are compressed
 * because Userscripts sends the whole script through Safari's native messaging for
 * every frame of every page; a large script there can fail to inject at all.
 */
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

/** Normalise a block: trim every line and drop blank lines inside sections. */
function compactBlock(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const urlEnd = lines.indexOf('');
  const url = urlEnd < 0 ? lines : lines.slice(0, urlEnd);
  const rest = urlEnd < 0 ? [] : lines.slice(urlEnd).filter(Boolean);
  return { url, text: [...url, '', ...rest].join('\n') };
}

/** Host key a pattern can be found under, or null if it needs a full scan. */
function patternKey(pattern) {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) return null;
  let p = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const proto = p.indexOf('://');
  if (proto > 0) p = p.slice(proto + 3);
  let host = p.split('/')[0].replace(/:\d+$/, '').toLowerCase();
  const parts = host.split('.');
  while (parts[0] === '*') parts.shift();
  if (parts[0] === 'www') parts.shift();
  if (!parts.length || parts.some((x) => x.includes('*'))) return null;
  return parts.join('.');
}

export async function buildFixesModule(path) {
  const text = (await readFile(path, 'utf8')).replace(/\r/g, '');
  const blocks = text.split(/^={4,}$/m).map((b) => b.trim()).filter(Boolean).map(compactBlock);
  const commonIndex = blocks.findIndex((b) => b.url.length === 1 && b.url[0] === '*');
  if (commonIndex < 0) throw new Error('fixes config has no "*" block');
  const common = blocks.splice(commonIndex, 1)[0];

  const index = new Map();
  const wild = [];
  blocks.forEach((b, i) => {
    for (const pattern of b.url) {
      const key = patternKey(pattern);
      if (key === null) {
        if (!wild.includes(i)) wild.push(i);
        continue;
      }
      const list = index.get(key) ?? [];
      if (!list.includes(i)) list.push(i);
      index.set(key, list);
    }
  });

  // Blocks are stored back to back in one string; OFFSETS[i]..OFFSETS[i + 1] is block i.
  const offsets = [];
  let data = '';
  for (const b of blocks) {
    offsets.push(data.length);
    data += b.text;
  }
  offsets.push(data.length);

  const indexText = '\n' + [...index].map(([k, v]) => `${k}\t${v.join(',')}`).join('\n') + '\n';
  const packed = deflateRawSync(JSON.stringify([data, offsets, indexText]), { level: 9 }).toString('base64');
  const code =
    `export const COMMON = ${JSON.stringify(common.text)};\n` +
    `export const PACKED = ${JSON.stringify(packed)};\n` +
    `export const WILD = ${JSON.stringify(wild)};\n`;
  return { code, stats: { blocks: blocks.length, keys: index.size, wild: wild.length, bytes: code.length } };
}
