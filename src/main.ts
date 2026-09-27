import { disable as disableEngine, enable as enableEngine, setFetchMethod } from 'darkreader';
import { isNativelyDark } from './detect';
import { gmFetch } from './fetch';
import { getFixFor, type SiteFix } from './fixes';
import { installPanel } from './panel';
import { loadSettings, normalizeHost, setMember, updateSettings, type Mode, type Settings } from './settings';
import { readSnapshot, settingsFromSnapshot, writeSnapshot, type Snapshot } from './snapshot';

const BACKGROUND = '#181a1b';
const TEXT = '#e8e6e3';
const THEME = { mode: 1 as const, darkSchemeBackgroundColor: BACKGROUND, darkSchemeTextColor: TEXT };
const DIM_CSS = 'img, video, picture, canvas { filter: brightness(88%) contrast(105%); }';
const ANTI_FLASH_ID = 'darksafari-antiflash';
const RELOAD_MESSAGE = 'darksafari:reload';

const isTop = window.top === window;

/** The site the user is visiting. Inside an iframe, that's the top-level page's site. */
function topHostname(): string {
  if (isTop) return location.hostname;
  try {
    return window.top!.location.hostname;
  } catch {
    // Cross-origin parent: fall back to what the browser tells us about our ancestors.
  }
  const origins = location.ancestorOrigins;
  const referrer = origins?.length ? origins[origins.length - 1] : document.referrer;
  try {
    return new URL(referrer).hostname;
  } catch {
    return location.hostname;
  }
}

const host = normalizeHost(topHostname());
const systemDark = matchMedia('(prefers-color-scheme: dark)');

let antiFlashObserver: MutationObserver | null = null;

/**
 * Settings load asynchronously, so paint a dark background right away when we will
 * probably darken the page. This avoids a white flash before the engine starts.
 */
function addAntiFlash() {
  if (document.getElementById(ANTI_FLASH_ID)) return;
  const style = document.createElement('style');
  style.id = ANTI_FLASH_ID;
  style.textContent = `html, body { background-color: ${BACKGROUND} !important; color: ${TEXT} !important; }`;
  const target = document.head ?? document.documentElement;
  if (target) {
    target.append(style);
    return;
  }
  // At document-start the <html> element may not exist yet.
  const observer = new MutationObserver(() => {
    if (!document.documentElement) return;
    observer.disconnect();
    if (!document.getElementById(ANTI_FLASH_ID)) document.documentElement.append(style);
  });
  observer.observe(document, { childList: true });
  antiFlashObserver = observer;
}

function removeAntiFlash() {
  antiFlashObserver?.disconnect();
  antiFlashObserver = null;
  document.getElementById(ANTI_FLASH_ID)?.remove();
}

/** Resolves once <html> exists; at document-start it sometimes doesn't yet. */
function rootReady(): Promise<void> {
  if (document.documentElement) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(document, { childList: true });
  });
}

let settings: Settings;
let settingsLoaded = false;
/** Whether this document looks dark on its own (cached per site for top-level pages). */
let nativeDark = false;
let engineOn = false;
let engineDim: boolean | null = null;
let siteFix: SiteFix | null = null;
let panel: { refresh(): void } | null = null;

function wantsDark(): boolean {
  return settings.mode === 'on' || (settings.mode === 'auto' && systemDark.matches);
}

function shouldDarken(): boolean {
  if (settings.mode === 'off' || settings.disabledHosts.includes(host)) return false;
  if (settings.forcedHosts.includes(host)) return true;
  return wantsDark() && !nativeDark;
}

function reason(): string {
  if (settings.mode === 'off') return 'DarkSafari is turned off everywhere.';
  if (settings.disabledHosts.includes(host)) return 'You turned this site off.';
  if (settings.forcedHosts.includes(host)) return 'You turned this site on.';
  if (!wantsDark()) return 'Your system is in light mode (Auto).';
  if (nativeDark) return 'This site already has a dark theme.';
  return 'Darkened automatically.';
}

function engineFix(dim: boolean): SiteFix {
  siteFix ??= getFixFor(location.href);
  return dim ? { ...siteFix, css: `${siteFix.css}\n${DIM_CSS}` } : siteFix;
}

function apply() {
  if (shouldDarken()) {
    if (!engineOn || engineDim !== settings.dimImages) {
      enableEngine(THEME, engineFix(settings.dimImages));
      engineOn = true;
      engineDim = settings.dimImages;
    }
    // Dark Reader paints its own fallback background from here on.
    removeAntiFlash();
  } else {
    if (engineOn) disableEngine();
    engineOn = false;
    engineDim = null;
    removeAntiFlash();
  }
  if (isTop && settingsLoaded) writeSnapshot(snapshot());
  panel?.refresh();
}

function snapshot(): Snapshot {
  const site = settings.disabledHosts.includes(host)
    ? 'disabled'
    : settings.forcedHosts.includes(host)
      ? 'forced'
      : nativeDark
        ? 'dark'
        : '';
  return { mode: settings.mode, dim: settings.dimImages, site };
}

/** Ask every frame inside this document to re-read settings (they can't see our changes). */
function notifyFrames() {
  for (let i = 0; i < window.frames.length; i++) {
    try {
      window.frames[i].postMessage(RELOAD_MESSAGE, '*');
    } catch {
      // Frame went away.
    }
  }
}

/** Check whether the page is dark on its own; top-level pages cache the answer per site. */
async function detect() {
  if (settings.forcedHosts.includes(host) || !wantsDark()) return;
  const dark = isNativelyDark();
  if (dark === nativeDark) return;
  nativeDark = dark;
  apply();
  if (isTop) settings = await updateSettings((s) => (s.darkHosts = setMember(s.darkHosts, host, dark)));
}

async function reload() {
  settings = await loadSettings();
  if (isTop) nativeDark = settings.darkHosts.includes(host) || nativeDark;
  apply();
  notifyFrames();
}

async function change(fn: (s: Settings) => void) {
  settings = await updateSettings(fn);
  apply();
  notifyFrames();
}

/**
 * Decide before the async settings arrive. Top-level pages keep a tiny snapshot of the
 * last decision in the site's own storage, so even "On" mode with a light system (or a
 * site you turned off) is right from the first paint.
 */
function startEarly() {
  const snap = isTop ? readSnapshot() : null;
  if (!snap) {
    if (systemDark.matches) addAntiFlash();
    return;
  }
  settings = settingsFromSnapshot(snap, host);
  nativeDark = snap.site === 'dark';
  if (!shouldDarken()) return;
  addAntiFlash();
  void rootReady().then(() => {
    if (!settingsLoaded) apply();
  });
}

async function main() {
  // Hidden and pixel-sized frames (trackers, ad plumbing) aren't worth theming.
  if (!isTop && (window.innerWidth < 60 || window.innerHeight < 30)) return;
  setFetchMethod(gmFetch);
  startEarly();

  settings = await loadSettings();
  settingsLoaded = true;
  if (isTop) nativeDark = settings.darkHosts.includes(host);
  await rootReady();
  apply();

  // Detect once the DOM exists, again after full load, and once more for late-rendering apps.
  const runDetect = () => void detect();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runDetect, { once: true });
  else runDetect();
  const afterLoad = () => {
    runDetect();
    setTimeout(runDetect, 1500);
  };
  if (document.readyState === 'complete') afterLoad();
  else window.addEventListener('load', afterLoad, { once: true });

  systemDark.addEventListener('change', () => {
    apply();
    runDetect();
  });
  // Pick up changes made in other tabs when coming back to this one.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reload();
  });

  if (!isTop) {
    window.addEventListener('message', (e) => {
      if (e.data === RELOAD_MESSAGE && e.source === window.parent) void reload();
    });
    return;
  }

  panel = installPanel({
    getState: () => ({ host, mode: settings.mode, dimImages: settings.dimImages, active: engineOn, reason: reason() }),
    toggleSite: () =>
      change((s) => {
        if (engineOn) {
          s.disabledHosts = setMember(s.disabledHosts, host, true);
          s.forcedHosts = setMember(s.forcedHosts, host, false);
        } else {
          const wasDisabled = s.disabledHosts.includes(host);
          s.disabledHosts = setMember(s.disabledHosts, host, false);
          // Removing a block is enough if the site would be darkened anyway; otherwise force it.
          const darkenedNow = s.mode !== 'off' && (s.mode === 'on' || (s.mode === 'auto' && systemDark.matches)) && !nativeDark;
          if (!wasDisabled || !darkenedNow) s.forcedHosts = setMember(s.forcedHosts, host, true);
        }
      }),
    setMode: (mode: Mode) =>
      change((s) => {
        s.mode = mode;
      }),
    setDimImages: (on: boolean) =>
      change((s) => {
        s.dimImages = on;
      }),
  });
}

void main();
