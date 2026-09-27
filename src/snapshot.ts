/**
 * A tiny synchronous copy of the last decision for this site, kept in the site's own
 * localStorage. GM.getValue is async, so without this the first paint has to guess.
 */
import { DEFAULTS, type Mode, type Settings } from './settings';

const KEY = 'darksafari:v1';

export interface Snapshot {
  mode: Mode;
  dim: boolean;
  /** This site's state: turned off, turned on, detected as already dark, or none. */
  site: 'disabled' | 'forced' | 'dark' | '';
}

export function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Snapshot>;
    if (s.mode !== 'auto' && s.mode !== 'on' && s.mode !== 'off') return null;
    return { mode: s.mode, dim: s.dim !== false, site: s.site ?? '' };
  } catch {
    return null;
  }
}

let lastWritten = '';

export function writeSnapshot(snap: Snapshot) {
  const value = JSON.stringify(snap);
  if (value === lastWritten) return;
  lastWritten = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage blocked (private mode, sandboxed page); we just lose the fast path.
  }
}

/** Enough of the settings to decide for `host` until the real ones load. */
export function settingsFromSnapshot(snap: Snapshot, host: string): Settings {
  return {
    ...DEFAULTS,
    mode: snap.mode,
    dimImages: snap.dim,
    disabledHosts: snap.site === 'disabled' ? [host] : [],
    forcedHosts: snap.site === 'forced' ? [host] : [],
    darkHosts: snap.site === 'dark' ? [host] : [],
  };
}
