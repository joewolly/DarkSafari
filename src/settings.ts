export type Mode = 'auto' | 'on' | 'off';

export interface Settings {
  /** auto = follow system appearance, on = always dark, off = paused everywhere. */
  mode: Mode;
  /** Slightly dim images and videos while a page is darkened. */
  dimImages: boolean;
  /** Sites the user turned off. */
  disabledHosts: string[];
  /** Sites the user always wants darkened, even if they look dark already or the system is light. */
  forcedHosts: string[];
  /** Cache of sites detected as natively dark, so repeat visits decide instantly. */
  darkHosts: string[];
}

const KEY = 'settings';
const MAX_DARK_HOSTS = 1000;

export const DEFAULTS: Settings = {
  mode: 'auto',
  dimImages: true,
  disabledHosts: [],
  forcedHosts: [],
  darkHosts: [],
};

export function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, '').toLowerCase();
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await GM.getValue<Partial<Settings> | null>(KEY, null);
    return { ...DEFAULTS, ...(raw ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Read-modify-write so concurrent tabs don't clobber each other's changes. */
export async function updateSettings(fn: (s: Settings) => void): Promise<Settings> {
  const s = await loadSettings();
  fn(s);
  if (s.darkHosts.length > MAX_DARK_HOSTS) s.darkHosts = s.darkHosts.slice(-MAX_DARK_HOSTS);
  try {
    await GM.setValue(KEY, s);
  } catch {
    // Storage unavailable; keep the in-memory value for this page.
  }
  return s;
}

export function setMember(list: string[], item: string, present: boolean): string[] {
  const without = list.filter((x) => x !== item);
  return present ? [...without, item] : without;
}
