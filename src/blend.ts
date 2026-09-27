/**
 * Sites like Amazon blend product photos into a light-grey tile with
 * `mix-blend-mode: multiply`, so the photos' white backgrounds disappear. Once the tile
 * is dark, multiply can only darken, and the photo (plus any badges in the same tile)
 * turns almost black. While a page is darkened, find images and text whose element or
 * nearby ancestors use a darkening blend mode, and switch those elements back to normal.
 */

const ATTR = 'data-darksafari-blend';
const STYLE_ID = 'darksafari-blend';
const DARKENING = new Set(['multiply', 'darken', 'color-burn', 'plus-darker']);
/** How far up from an image to look for the blended tile. */
const MAX_DEPTH = 6;
const MEDIA = 'img, picture, video, canvas';

let observer: MutationObserver | null = null;
let seen = new WeakSet<Element>();
let queue: Element[] = [];
let timer = 0;

function check(media: Element) {
  let el: Element | null = media;
  for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
    // Siblings share ancestors; each one only needs checking once.
    if (seen.has(el)) return;
    seen.add(el);
    if (DARKENING.has(getComputedStyle(el).mixBlendMode)) el.setAttribute(ATTR, '');
  }
}

function flush() {
  timer = 0;
  const batch = queue;
  queue = [];
  for (const node of batch) {
    if (!node.isConnected) continue;
    if (node.matches(MEDIA)) check(node);
    node.querySelectorAll(MEDIA).forEach(check);
    // Some tiles blend their text area separately from the image (light text
    // multiplied onto a dark tile nearly vanishes), so look up from text too.
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.parentElement && t.nodeValue?.trim()) check(t.parentElement);
    }
  }
}

function enqueue(node: Element) {
  queue.push(node);
  timer ||= window.setTimeout(flush, 100);
}

export function startBlendFix() {
  if (observer || !document.documentElement) return;
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `[${ATTR}] { mix-blend-mode: normal !important; }`;
    (document.head ?? document.documentElement).append(style);
  }
  observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && enqueue(n as Element));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enqueue(document.documentElement);
}

export function stopBlendFix() {
  observer?.disconnect();
  observer = null;
  clearTimeout(timer);
  timer = 0;
  queue = [];
  seen = new WeakSet();
  document.getElementById(STYLE_ID)?.remove();
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
}
