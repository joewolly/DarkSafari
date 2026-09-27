/**
 * A tiny settings panel. Userscripts has no menu-command API, so it opens with:
 *   - Ctrl+Option+D on a Mac keyboard
 *   - a two-finger long-press on iPhone/iPad
 */
import type { Mode } from './settings';

export interface PanelState {
  host: string;
  mode: Mode;
  dimImages: boolean;
  /** Whether DarkSafari is darkening this page right now. */
  active: boolean;
  /** Why the page is or isn't darkened, in a few words. */
  reason: string;
}

export interface PanelActions {
  getState(): PanelState;
  toggleSite(): Promise<void>;
  setMode(mode: Mode): Promise<void>;
  setDimImages(on: boolean): Promise<void>;
}

const LONG_PRESS_MS = 600;
const MOVE_TOLERANCE = 12;

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;
  width: min(300px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px;
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
  color: #e8e6e3; background: rgba(28, 30, 31, 0.96); border: 1px solid #3a3e41;
  border-radius: 14px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.title { font-weight: 600; }
.host { color: #a8a49e; font-size: 12px; margin: 2px 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; border-radius: 8px; }
.close { background: none; font-size: 18px; line-height: 1; padding: 4px 6px; color: #a8a49e; }
.site { width: 100%; padding: 10px; margin-bottom: 4px; background: #2f6fdb; color: #fff; font-weight: 600; }
.site.off { background: #3a3e41; color: #e8e6e3; }
.site:disabled { opacity: 0.5; cursor: default; }
.reason { color: #a8a49e; font-size: 12px; margin-bottom: 12px; }
.seg { display: flex; background: #2a2d2f; border-radius: 9px; padding: 2px; margin: 6px 0 12px; }
.seg button { flex: 1; padding: 6px 0; background: none; }
.seg button[aria-pressed="true"] { background: #464b4f; }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.hint { color: #7d7a75; font-size: 11px; margin-top: 10px; }
`;

export function installPanel(actions: PanelActions): { refresh(): void } {
  let host: HTMLElement | null = null;
  let panel: HTMLElement | null = null;

  function render() {
    if (!panel) return;
    const s = actions.getState();
    panel.innerHTML = '';
    panel.append(
      el('div', { class: 'row' }, [
        el('span', { class: 'title' }, ['DarkSafari']),
        button('×', { class: 'close', 'aria-label': 'Close' }, close),
      ]),
      el('div', { class: 'host' }, [s.host]),
      button(s.active ? 'Dark on this site — turn off' : 'Off on this site — turn on', { class: s.active ? 'site' : 'site off', ...(s.mode === 'off' ? { disabled: '' } : {}) }, () =>
        actions.toggleSite().then(render),
      ),
      el('div', { class: 'reason' }, [s.reason]),
      el('div', {}, ['Everywhere']),
      el(
        'div',
        { class: 'seg', role: 'group' },
        (['auto', 'on', 'off'] as Mode[]).map((m) =>
          button(m === 'auto' ? 'Auto' : m === 'on' ? 'On' : 'Off', { 'aria-pressed': String(s.mode === m) }, () =>
            actions.setMode(m).then(render),
          ),
        ),
      ),
      checkbox('Dim images slightly', s.dimImages, (on) => actions.setDimImages(on).then(render)),
      el('div', { class: 'hint' }, ['Auto follows your system appearance. Open with Ctrl+Option+D or a two-finger long-press.']),
    );
  }

  function open() {
    if (host) return render();
    host = document.createElement('darksafari-panel');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'DarkSafari settings' }, []);
    shadow.append(style, panel);
    document.documentElement.append(host);
    render();
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true));
  }

  function close() {
    host?.remove();
    host = panel = null;
    document.removeEventListener('pointerdown', onOutside, true);
  }

  function onOutside(e: Event) {
    if (host && !e.composedPath().includes(host)) close();
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.altKey && !e.metaKey && e.code === 'KeyD') {
        e.preventDefault();
        host ? close() : open();
      } else if (e.key === 'Escape' && host) {
        close();
      }
    },
    true,
  );

  // Two-finger long-press (iOS). Cancelled by lifting a finger or pinching/scrolling.
  let timer = 0;
  let start: { x: number; y: number }[] = [];
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
  };
  document.addEventListener(
    'touchstart',
    (e) => {
      cancel();
      if (e.touches.length !== 2) return;
      start = Array.from(e.touches, (t) => ({ x: t.clientX, y: t.clientY }));
      timer = window.setTimeout(() => {
        timer = 0;
        open();
      }, LONG_PRESS_MS);
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!timer) return;
      const moved = Array.from(e.touches).some((t, i) => {
        const s = start[i];
        return !s || Math.abs(t.clientX - s.x) > MOVE_TOLERANCE || Math.abs(t.clientY - s.y) > MOVE_TOLERANCE;
      });
      if (moved) cancel();
    },
    { passive: true, capture: true },
  );
  document.addEventListener('touchend', cancel, { passive: true, capture: true });
  document.addEventListener('touchcancel', cancel, { passive: true, capture: true });

  return { refresh: render };
}

function el(tag: string, attrs: Record<string, string>, children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function button(label: string, attrs: Record<string, string>, onClick: () => void): HTMLElement {
  const b = el('button', { type: 'button', ...attrs }, [label]);
  b.addEventListener('click', onClick);
  return b;
}

function checkbox(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', {}, [input, label]);
}
