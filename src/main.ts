import { disable as disableEngine, enable as enableEngine, setFetchMethod } from 'darkreader';
import { isNativelyDark } from './detect';
import { gmFetch } from './fetch';
import { installPanel } from './panel';
import { loadSettings, normalizeHost, setMember, updateSettings, type Mode, type Settings } from './settings';

const BACKGROUND = '#181a1b';
const TEXT = '#e8e6e3';
const THEME = { mode: 1 as const, darkSchemeBackgroundColor: BACKGROUND, darkSchemeTextColor: TEXT };
const DIM_FIX = {
  css: 'img, video, picture, canvas { filter: brightness(88%) contrast(105%); }',
  invert: [],
  ignoreInlineStyle: [],
  ignoreImageAnalysis: [],
  disableStyleSheetsProxy: false,
  ignoreCSSUrl: [],
};
const ANTI_FLASH_ID = 'darksafari-antiflash';

const host = normalizeHost(location.hostname);
const systemDark = matchMedia('(prefers-color-scheme: dark)');

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

let antiFlashObserver: MutationObserver | null = null;

function removeAntiFlash() {
  antiFlashObserver?.disconnect();
  antiFlashObserver = null;
  document.getElementById(ANTI_FLASH_ID)?.remove();
}

if (systemDark.matches) addAntiFlash();

let settings: Settings;
let nativeDark = false;
let engineOn = false;
let engineDim: boolean | null = null;

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

function apply() {
  if (shouldDarken()) {
    if (!engineOn || engineDim !== settings.dimImages) {
      enableEngine(THEME, settings.dimImages ? DIM_FIX : undefined);
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
  panel?.refresh();
}

/** Check whether the page is dark on its own; cache the answer per site. */
async function detect() {
  if (settings.forcedHosts.includes(host) || !wantsDark()) return;
  const dark = isNativelyDark();
  if (dark === nativeDark) return;
  nativeDark = dark;
  apply();
  settings = await updateSettings((s) => (s.darkHosts = setMember(s.darkHosts, host, dark)));
}

async function reload() {
  settings = await loadSettings();
  apply();
}

async function change(fn: (s: Settings) => void) {
  settings = await updateSettings(fn);
  apply();
}

let panel: { refresh(): void } | null = null;

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

async function main() {
  setFetchMethod(gmFetch);
  settings = await loadSettings();
  nativeDark = settings.darkHosts.includes(host);
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
