import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPT = readFileSync(join(__dirname, '..', 'dist', 'darksafari.user.js'), 'utf8');
const FIXTURES = join(__dirname, 'fixtures');

const SITE = 'https://www.example.com';
const CDN = 'https://cdn.example.net';
const HOST = 'example.com';

function fixture(url: string): { body: string; type: string } | null {
  const name = new URL(url).pathname.slice(1);
  try {
    const body = readFileSync(join(FIXTURES, name), 'utf8').replace('{{CDN}}', CDN);
    return { body, type: name.endsWith('.css') ? 'text/css' : 'text/html' };
  } catch {
    return null;
  }
}

/** Install an in-memory GM API (like the Userscripts extension provides), then the userscript. */
async function install(page: Page, settings: Record<string, unknown> = {}) {
  // GM.xmlHttpRequest runs outside the page (no CORS), like the real extension.
  await page.route(/^https:\/\/(www\.example\.com|cdn\.example\.net)\//, (route) => {
    const f = fixture(route.request().url());
    return f ? route.fulfill({ contentType: f.type, body: f.body }) : route.fulfill({ status: 404 });
  });
  await page.exposeFunction('__gmFetch', async (url: string) => {
    const f = fixture(url);
    return f ? { status: 200, text: f.body } : { status: 404, text: '' };
  });
  await page.addInitScript((initial) => {
    const store: Record<string, unknown> = { settings: initial };
    (window as any).__gmStore = store;
    (window as any).GM = {
      getValue: async (k: string, d?: unknown) => (k in store ? structuredClone(store[k]) : d),
      setValue: async (k: string, v: unknown) => {
        store[k] = structuredClone(v);
      },
      xmlHttpRequest: async ({ url }: { url: string }) => {
        const r = await (window as any).__gmFetch(url);
        return { status: r.status, statusText: '', response: new Blob([r.text]), responseText: r.text };
      },
    };
  }, settings);
  await page.addInitScript(SCRIPT);
}

const url = (name: string) => `${SITE}/${name}`;

/** Relative luminance of an element's computed background color. */
async function bgLuminance(page: Page, selector = 'body'): Promise<number> {
  return page.evaluate((sel) => {
    const c = getComputedStyle(document.querySelector(sel)!).backgroundColor.match(/[\d.]+/g)!.map(Number);
    const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  }, selector);
}

const hasEngineStyles = (page: Page) => page.evaluate(() => !!document.querySelector('style.darkreader:not(.darkreader--fallback)'));
const storedSettings = (page: Page) => page.evaluate(() => (window as any).__gmStore.settings);

test.describe('system dark', () => {
  test.use({ colorScheme: 'dark' });

  test('darkens a light page', async ({ page }) => {
    await install(page);
    await page.goto(url('light.html'));
    await expect.poll(() => bgLuminance(page)).toBeLessThan(0.05);
    await expect.poll(() => bgLuminance(page, '.card')).toBeLessThan(0.1);
  });

  test('removes the anti-flash style after load', async ({ page }) => {
    await install(page);
    await page.goto(url('light.html'));
    await page.waitForLoadState('load');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('darksafari-antiflash'))).toBe(false);
  });

  test('leaves an already-dark page alone and remembers it', async ({ page }) => {
    await install(page);
    await page.goto(url('dark.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(13, 17, 23)');
    await expect.poll(async () => (await storedSettings(page))?.darkHosts).toContain(HOST);
  });

  test('leaves a site with its own prefers-color-scheme dark mode alone', async ({ page }) => {
    await install(page);
    await page.goto(url('adaptive.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 17, 17)');
  });

  test('respects a site the user turned off', async ({ page }) => {
    await install(page, { disabledHosts: [HOST] });
    await page.goto(url('light.html'));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    expect(await hasEngineStyles(page)).toBe(false);
    expect(await bgLuminance(page)).toBeGreaterThan(0.9);
  });

  test('darkens a forced site even if it looks dark', async ({ page }) => {
    await install(page, { forcedHosts: [HOST] });
    await page.goto(url('dark.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(true);
  });

  test('reads cross-origin stylesheets through GM.xmlHttpRequest', async ({ page }) => {
    await install(page);
    await page.goto(url('crossorigin.html'));
    await expect.poll(() => bgLuminance(page, 'main')).toBeLessThan(0.1);
  });

  test('panel toggles the current site off and on', async ({ page }) => {
    await install(page);
    await page.goto(url('light.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(true);

    await page.keyboard.press('Control+Alt+KeyD');
    const panel = page.locator('darksafari-panel');
    await expect(panel).toHaveCount(1);

    await panel.getByRole('button', { name: /turn off/ }).click();
    await expect.poll(() => hasEngineStyles(page)).toBe(false);
    expect((await storedSettings(page)).disabledHosts).toContain(HOST);

    await panel.getByRole('button', { name: /turn on/ }).click();
    await expect.poll(() => hasEngineStyles(page)).toBe(true);
    const s = await storedSettings(page);
    expect(s.disabledHosts).not.toContain(HOST);
    expect(s.forcedHosts).not.toContain(HOST);

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });
});

test.describe('auto mode follows the system', () => {
  test('light system leaves pages alone, switching to dark darkens live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await install(page);
    await page.goto(url('light.html'));
    await page.waitForLoadState('load');
    expect(await hasEngineStyles(page)).toBe(false);
    expect(await bgLuminance(page)).toBeGreaterThan(0.9);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => bgLuminance(page)).toBeLessThan(0.05);

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => bgLuminance(page)).toBeGreaterThan(0.9);
  });

  test('mode "on" darkens even when the system is light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await install(page, { mode: 'on' });
    await page.goto(url('light.html'));
    await expect.poll(() => bgLuminance(page)).toBeLessThan(0.05);
  });
});
