/**
 * Native dark theme detection: decide whether a page already looks dark on its own,
 * so we can leave it alone instead of re-theming it.
 */

type RGBA = [number, number, number, number];

const DARK_LUMINANCE = 0.2;
const LIGHT_TEXT_LUMINANCE = 0.6;

/** Selectors for the styles DarkSafari and Dark Reader inject into the page. */
const OUR_STYLES = 'style.darkreader, style[id^="darksafari-"]';

function parseColor(value: string): RGBA | null {
  if (!value || value === 'transparent') return [0, 0, 0, 0];
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function canvasIsDark(): boolean {
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  if (!/\bdark\b/.test(scheme)) return false;
  return !/\blight\b/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Background luminance behind an element: walk up until something is mostly opaque. */
function effectiveBackground(el: Element | null): number {
  for (let node = el; node; node = node.parentElement) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c && c[3] >= 0.5) return luminance(c);
  }
  return canvasIsDark() ? 0 : 1;
}

/** Run fn with every style we injected switched off, so we measure the page's own look. */
function withoutOurStyles<T>(fn: () => T): T {
  const styles = Array.from(document.querySelectorAll<HTMLStyleElement>(OUR_STYLES));
  const previous = styles.map((s) => s.sheet?.disabled ?? false);
  styles.forEach((s) => s.sheet && (s.sheet.disabled = true));
  const root = document.documentElement;
  // Dark Reader marks the root while active; some of its rules key off these attributes.
  const attrs = ['data-darkreader-mode', 'data-darkreader-scheme'].map((a) => [a, root.getAttribute(a)] as const);
  attrs.forEach(([a, v]) => v !== null && root.removeAttribute(a));
  try {
    return fn();
  } finally {
    attrs.forEach(([a, v]) => v !== null && root.setAttribute(a, v));
    styles.forEach((s, i) => s.sheet && (s.sheet.disabled = previous[i]));
  }
}

function metaSaysDarkOnly(): boolean {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  const content = meta?.content.toLowerCase().trim() ?? '';
  return content === 'dark' || content === 'only dark';
}

/** Returns true when the page already has a dark appearance without our help. */
export function isNativelyDark(): boolean {
  if (metaSaysDarkOnly()) return true;
  if (!document.body) return false;

  return withoutOurStyles(() => {
    const votes: boolean[] = [];
    votes.push(effectiveBackground(document.body) < DARK_LUMINANCE);

    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const [x, y] of [[w / 2, h / 2], [w / 2, h / 4]]) {
      const el = document.elementFromPoint(x, y);
      if (el && el !== document.documentElement) votes.push(effectiveBackground(el) < DARK_LUMINANCE);
    }

    const text = parseColor(getComputedStyle(document.body).color);
    if (text && text[3] > 0) votes.push(luminance(text) > LIGHT_TEXT_LUMINANCE);

    return votes.filter(Boolean).length > votes.length / 2;
  });
}
