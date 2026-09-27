import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCRIPT = readFileSync(join(__dirname, '..', 'dist', 'darksafari.user.js'), 'utf8');
const FIXTURES = join(__dirname, 'fixtures');

/**
 * The script the way the Userscripts extension runs it: metadata stripped and run with
 * `Function` in the content world, with GM passed in as a destructured parameter rather
 * than a global. Newer Userscripts versions wrap the code in an async function first;
 * older ones (the App Store build users have) use it as the function body directly.
 * (See quoid/userscripts entry-userscripts.js.)
 */
function asUserscriptsInjects(script: string, wrap: boolean): string {
  const code = script.replace(/^[\s\S]*?\/\/ ==\/UserScript==/, '').trim();
  const body = wrap
    ? `(async () => {\n\ttry {\n// ===UserScript===start===\n${code}\n// ===UserScript====end====\n\t} catch (error) {\n\t\tconsole.error('darksafari.user.js', error);\n\t}\n})(); //# sourceURL=darksafari.user.js`
    : code;
  return `(() => { const GM = window.GM; delete window.GM; try { Function('{GM,GM_info}', ${JSON.stringify(body)})({ GM, GM_info: {} }); } catch (e) { console.error('inject failed', e); } })();`;
}

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
async function install(page: Page, settings: Record<string, unknown> = {}, gmDelayMs = 0, script = SCRIPT) {
  // GM.xmlHttpRequest runs outside the page (no CORS), like the real extension.
  await page.route(/^https:\/\//, (route) => {
    const f = fixture(route.request().url());
    return f ? route.fulfill({ contentType: f.type, body: f.body }) : route.fulfill({ status: 404 });
  });
  await page.exposeFunction('__gmFetch', async (url: string) => {
    const f = fixture(url);
    return f ? { status: 200, text: f.body } : { status: 404, text: '' };
  });
  // One store for the whole page and all its frames, like the extension's storage.
  const store: Record<string, unknown> = { settings };
  stores.set(page, store);
  await page.exposeFunction('__gmGet', (k: string) => (k in store ? JSON.stringify(store[k]) : undefined));
  await page.exposeFunction('__gmSet', (k: string, v: string) => {
    store[k] = JSON.parse(v);
  });
  await page.addInitScript((delay) => {
    const w = window as any;
    w.GM = {
      getValue: async (k: string, d?: unknown) => {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        const v = await w.__gmGet(k);
        return v === undefined ? d : JSON.parse(v);
      },
      setValue: (k: string, v: unknown) => w.__gmSet(k, JSON.stringify(v)),
      xmlHttpRequest: async ({ url }: { url: string }) => {
        const r = await w.__gmFetch(url);
        return { status: r.status, statusText: '', response: new Blob([r.text]), responseText: r.text };
      },
    };
  }, gmDelayMs);
  await page.addInitScript(script);
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
const stores = new WeakMap<Page, Record<string, unknown>>();
const storedSettings = async (page: Page): Promise<any> => stores.get(page)!.settings;

test('script stays small', () => {
  // Userscripts sends the whole script through Safari's native messaging for every
  // frame of every page, so keep it small.
  expect(SCRIPT.length).toBeLessThan(600 * 1024);
});

test.describe('system dark', () => {
  test.use({ colorScheme: 'dark' });

  for (const wrap of [false, true]) {
    test(`works when injected the way Userscripts does it (${wrap ? 'wrapped' : 'as function body'})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await install(page, {}, 0, asUserscriptsInjects(SCRIPT, wrap));
      await page.goto(url('light.html'));
      await expect.poll(() => bgLuminance(page)).toBeLessThan(0.05);
      await page.keyboard.press('Control+Alt+KeyD');
      await expect(page.locator('darksafari-panel')).toHaveCount(1);
      expect(errors).toEqual([]);
    });
  }

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

  test('undoes darkening blend modes on images, including ones added later', async ({ page }) => {
    const blend = (id: string) => page.evaluate((i) => {
      const el = document.getElementById(i);
      return el && getComputedStyle(el).mixBlendMode;
    }, id);
    await install(page);
    await page.goto(url('blend.html'));
    await expect.poll(() => blend('wrapped')).toBe('normal');
    await expect.poll(() => blend('direct')).toBe('normal');
    await expect.poll(() => blend('late')).toBe('normal');
    await expect.poll(() => blend('text-only')).toBe('normal');

    // Turning the site off restores the page's own blend modes.
    await page.keyboard.press('Control+Alt+KeyD');
    await page.locator('darksafari-panel').locator('button.site').click();
    await expect.poll(() => blend('wrapped')).toBe('multiply');
    expect(await blend('direct')).toBe('darken');
  });

  test('makes low-contrast text on dark backgrounds readable', async ({ page }) => {
    const contrast = (id: string) =>
      page.evaluate((i) => {
        const lum = (s: string) => {
          const [r, g, b] = s.match(/[\d.]+/g)!.map(Number).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const cs = getComputedStyle(document.getElementById(i)!);
        const a = lum(cs.color);
        const b = lum(cs.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, id);
    await install(page);
    await page.goto(url('badge.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(true);
    await expect.poll(() => contrast('badge')).toBeGreaterThan(3);
    expect(await page.evaluate(() => document.getElementById('ok')!.hasAttribute('data-darksafari-contrast'))).toBe(false);
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

/** All CSS Dark Reader generated for the top document. */
const engineCSS = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('style.darkreader'), (s) => s.textContent).join('\n'));

test.describe('site fixes', () => {
  test.use({ colorScheme: 'dark' });

  test('applies the matching Dark Reader fix for a site', async ({ page }) => {
    await install(page);
    await page.goto('https://github.com/light.html');
    await expect.poll(() => engineCSS(page)).toContain('footer/github-logo.svg');
  });

  test('does not apply another site’s fix', async ({ page }) => {
    await install(page);
    await page.goto(url('light.html'));
    await expect.poll(() => hasEngineStyles(page)).toBe(true);
    expect(await engineCSS(page)).not.toContain('footer/github-logo.svg');
  });

  test('follows Dark Reader URL rules: "github.com" does not cover other subdomains', async ({ page }) => {
    await install(page);
    await page.goto('https://gist.github.com/light.html');
    await expect.poll(() => hasEngineStyles(page)).toBe(true);
    expect(await engineCSS(page)).not.toContain('footer/github-logo.svg');
  });
});

test.describe('frames', () => {
  test.use({ colorScheme: 'dark' });

  const frameLuminance = async (page: Page) => {
    const frame = page.frames().find((f) => f.url().startsWith(CDN));
    if (!frame) return NaN;
    return frame.evaluate(() => {
      const c = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number);
      return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    });
  };

  test('darkens embedded frames', async ({ page }) => {
    await install(page);
    await page.goto(url('with-frame.html'));
    await expect.poll(() => frameLuminance(page)).toBeLessThan(0.2);
  });

  test('frames follow the top site being turned off, live', async ({ page }) => {
    await install(page);
    await page.goto(url('with-frame.html'));
    await expect.poll(() => frameLuminance(page)).toBeLessThan(0.2);

    await page.keyboard.press('Control+Alt+KeyD');
    await page.locator('darksafari-panel').getByRole('button', { name: /turn off/ }).click();
    await expect.poll(() => frameLuminance(page)).toBeGreaterThan(0.9);
  });

  test('frames on a site the user turned off stay untouched', async ({ page }) => {
    await install(page, { disabledHosts: [HOST] });
    await page.goto(url('with-frame.html'));
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    expect(await frameLuminance(page)).toBeGreaterThan(0.9);
  });
});

test.describe('first paint uses the cached decision', () => {
  // Slow settings storage, so anything dark at DOMContentLoaded came from the snapshot.
  const SLOW = 1500;
  const bodyLumAtDCL = (page: Page) =>
    page.evaluate(() => {
      const c = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)!.map(Number);
      return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    });

  test('"On" mode with a light system is dark before settings load on repeat visits', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await install(page, { mode: 'on' }, SLOW);
    await page.goto(url('light.html'), { waitUntil: 'domcontentloaded' });
    // First visit: no snapshot yet, so the page starts light.
    expect(await bodyLumAtDCL(page)).toBeGreaterThan(0.9);
    await expect.poll(() => bgLuminance(page), { timeout: 10000 }).toBeLessThan(0.05);

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await bodyLumAtDCL(page)).toBeLessThan(0.2);
  });

  test('a site the user turned off does not start dark on repeat visits', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await install(page, { disabledHosts: [HOST] }, SLOW);
    await page.goto(url('light.html'));
    await page.waitForTimeout(SLOW + 300);

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(await bodyLumAtDCL(page)).toBeGreaterThan(0.9);
  });
});
