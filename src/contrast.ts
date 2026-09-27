/**
 * Dark Reader sometimes darkens a coloured background but leaves the text on it in a
 * similar colour (Amazon's red deal badges become red on dark red). While a page is
 * darkened, find text that barely contrasts with the dark background behind it and
 * switch it to the normal light text colour.
 */

const ATTR = 'data-darksafari-contrast';
const STYLE_ID = 'darksafari-contrast';
const MIN_CONTRAST = 3;
/** Only fix text on dark backgrounds; light ones are Dark Reader's business. */
const DARK_BACKGROUND = 0.2;
/** How far up from the text to look for its background. */
const MAX_DEPTH = 4;

type RGBA = [number, number, number, number];

function parseColor(value: string): RGBA | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (p.length < 3 || p.some(Number.isNaN)) return null;
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function background(el: Element): RGBA | null {
  let node: Element | null = el;
  for (let depth = 0; node && depth < MAX_DEPTH; depth++, node = node.parentElement) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c && c[3] >= 0.5) return c;
  }
  return null;
}

function check(el: Element) {
  if (el.hasAttribute(ATTR)) return;
  const color = parseColor(getComputedStyle(el).color);
  if (!color || color[3] < 0.5) return;
  const bg = background(el);
  if (!bg) return;
  const lb = luminance(bg);
  if (lb >= DARK_BACKGROUND) return;
  const lc = luminance(color);
  const ratio = (Math.max(lb, lc) + 0.05) / (Math.min(lb, lc) + 0.05);
  if (ratio < MIN_CONTRAST) el.setAttribute(ATTR, '');
}

/** Every element under root that directly holds visible text. */
function scan(root: Node) {
  const checked = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || checked.has(el) || !n.nodeValue?.trim()) continue;
    checked.add(el);
    if (el.closest('script, style, noscript, darksafari-panel')) continue;
    check(el);
  }
}

let observer: MutationObserver | null = null;
let queue: Node[] = [];
let timer = 0;
let rescans: number[] = [];

function flush() {
  timer = 0;
  const batch = queue;
  queue = [];
  for (const node of batch) if (node.isConnected) scan(node);
}

function enqueue(node: Node) {
  queue.push(node);
  timer ||= window.setTimeout(flush, 300);
}

export function startContrastFix(textColor: string) {
  if (observer || !document.documentElement) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `[${ATTR}] { color: ${textColor} !important; }`;
    (document.head ?? document.documentElement).append(style);
  }
  observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) && enqueue(n.nodeType === Node.TEXT_NODE ? n.parentNode ?? n : n));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Dark Reader restyles the page in stages as stylesheets load; look again later.
  const rescan = () => enqueue(document.documentElement);
  rescan();
  rescans = [1000, 3000].map((ms) => window.setTimeout(rescan, ms));
  if (document.readyState !== 'complete') window.addEventListener('load', rescan, { once: true });
}

export function stopContrastFix() {
  observer?.disconnect();
  observer = null;
  clearTimeout(timer);
  rescans.forEach(clearTimeout);
  timer = 0;
  rescans = [];
  queue = [];
  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
}
