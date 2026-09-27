/**
 * Dark Reader's per-site fixes: selectors to invert and extra CSS for sites the engine
 * alone doesn't get right. Only the blocks that match the current page are parsed.
 */
import { COMMON, PACKED, WILD } from 'darksafari:fixes-data';

export interface SiteFix {
  url: string[];
  invert: string[];
  css: string;
  ignoreInlineStyle: string[];
  ignoreImageAnalysis: string[];
  ignoreCSSUrl: string[];
  disableStyleSheetsProxy: boolean;
}

const COMMANDS: Record<string, keyof SiteFix> = {
  INVERT: 'invert',
  CSS: 'css',
  'IGNORE INLINE STYLE': 'ignoreInlineStyle',
  'IGNORE IMAGE ANALYSIS': 'ignoreImageAnalysis',
  'IGNORE CSS URL': 'ignoreCSSUrl',
};

export function emptyFix(): SiteFix {
  return { url: [], invert: [], css: '', ignoreInlineStyle: [], ignoreImageAnalysis: [], ignoreCSSUrl: [], disableStyleSheetsProxy: false };
}

export function parseBlock(text: string): SiteFix {
  const fix = emptyFix();
  const lines = text.split('\n');
  let i = 0;
  for (; i < lines.length && lines[i]; i++) fix.url.push(lines[i]);
  let current: keyof SiteFix | null = null;
  const css: string[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (COMMANDS[line]) current = COMMANDS[line];
    else if (current === 'css') css.push(line);
    else if (current) (fix[current] as string[]).push(line);
  }
  fix.css = css.join('\n');
  return fix;
}

// URL pattern matching, ported from Dark Reader's src/utils/url.ts (MIT License).
// "example.com" matches example.com and www.example.com; "*.example.com" matches any
// subdomain; a path narrows the match; ^ and $ anchor host and path; /.../ is a RegExp.
export function isURLMatched(url: string, pattern: string): boolean {
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(url);
    } catch {
      return false;
    }
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const uHost = u.hostname.split('.').reverse();
  const uPath = u.pathname.split('/').slice(1);
  if (!uPath[uPath.length - 1]) uPath.pop();

  const exactStart = pattern.startsWith('^');
  const exactEnd = pattern.endsWith('$');
  let p = pattern.slice(exactStart ? 1 : 0, exactEnd ? -1 : undefined);
  let protocol = '';
  const protocolIndex = p.indexOf('://');
  if (protocolIndex > 0) {
    protocol = p.slice(0, protocolIndex + 1);
    p = p.slice(protocolIndex + 3);
  }
  const slash = p.indexOf('/');
  let host = slash < 0 ? p : p.slice(0, slash);
  let port = '*';
  const portIndex = host.lastIndexOf(':');
  if (portIndex >= 0 && !host.startsWith('[')) {
    port = host.slice(portIndex + 1);
    host = host.slice(0, portIndex);
  }
  const pHost = host.split('.').reverse();
  const pPath = slash < 0 ? [] : p.slice(slash + 1).split('/');
  if (pPath.length && !pPath[pPath.length - 1]) pPath.pop();

  if (
    pHost.length > uHost.length ||
    (exactStart && pHost.length !== uHost.length) ||
    (exactEnd && pPath.length !== uPath.length) ||
    (port !== '*' && port !== u.port) ||
    (protocol && protocol !== u.protocol)
  ) {
    return false;
  }
  for (let i = 0; i < pHost.length; i++) {
    if (pHost[i] !== '*' && pHost[i] !== uHost[i]) return false;
  }
  if (
    pHost.length >= 2 &&
    pHost[pHost.length - 1] !== '*' &&
    (pHost.length < uHost.length - 1 || (pHost.length === uHost.length - 1 && uHost[uHost.length - 1] !== 'www'))
  ) {
    return false;
  }
  if (pPath.length > uPath.length) return false;
  for (let i = 0; i < pPath.length; i++) {
    if (pPath[i] !== '*' && pPath[i] !== uPath[i]) return false;
  }
  return true;
}

interface Unpacked {
  data: string;
  offsets: number[];
  index: string;
}

let unpacked: Promise<Unpacked | null> | null = null;

/** Decompress the site fixes once per page. Null if the browser can't (Safari < 16.4). */
function unpack(): Promise<Unpacked | null> {
  unpacked ??= (async () => {
    try {
      const bytes = Uint8Array.from(atob(PACKED), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const [data, offsets, index] = JSON.parse(await new Response(stream).text());
      return { data, offsets, index };
    } catch (error) {
      console.warn('DarkSafari: site fixes unavailable', error);
      return null;
    }
  })();
  return unpacked;
}

/** Block indices whose patterns might match this hostname (every dot-suffix of it). */
function candidates(index: string, hostname: string): number[] {
  const found = new Set<number>(WILD);
  const parts = hostname.toLowerCase().split('.');
  for (let i = 0; i < parts.length; i++) {
    const key = `\n${parts.slice(i).join('.')}\t`;
    const at = index.indexOf(key);
    if (at < 0) continue;
    const end = index.indexOf('\n', at + key.length);
    for (const n of index.slice(at + key.length, end).split(',')) found.add(Number(n));
  }
  return [...found].sort((a, b) => a - b);
}

/** The common fix plus every site fix matching `url`, merged into one. */
export async function getFixFor(url: string): Promise<SiteFix> {
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const fixes = [parseBlock(COMMON)];
  const packed = await unpack();
  if (packed) {
    for (const i of candidates(packed.index, hostname)) {
      const fix = parseBlock(packed.data.slice(packed.offsets[i], packed.offsets[i + 1]));
      if (fix.url.some((pattern) => isURLMatched(url, pattern))) fixes.push(fix);
    }
  }
  const merged = emptyFix();
  for (const f of fixes) {
    merged.url.push(...f.url);
    merged.invert.push(...f.invert);
    merged.ignoreInlineStyle.push(...f.ignoreInlineStyle);
    merged.ignoreImageAnalysis.push(...f.ignoreImageAnalysis);
    merged.ignoreCSSUrl.push(...f.ignoreCSSUrl);
    if (f.css) merged.css += (merged.css ? '\n' : '') + f.css;
  }
  return merged;
}
