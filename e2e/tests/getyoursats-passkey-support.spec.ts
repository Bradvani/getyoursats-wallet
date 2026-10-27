import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';

type Copy = { title: string; intro: string; safety: string; contact: string; nav: string; scenarios: Record<string, { title: string; steps: string[] }> };
const copies: Record<string, Copy> = JSON.parse(readFileSync('scripts/support/passkey-copy.json', 'utf8'));
const appLanguages = [...readFileSync('src/services/presentationPreferences.ts', 'utf8').matchAll(/\{code:'([^']+)',name:/g)].map(match => match[1]);

async function serve(page: Page, host: string) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/contact') return route.fulfill({ json: { available: false } });
    const path = resolve(host, '.' + url.pathname);
    if (!path.startsWith(resolve(host) + '/') || !existsSync(path)) return route.fulfill({ status: 404, body: '' });
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
    return route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', body: readFileSync(path) });
  });
}

test('@public-smoke passkey guide covers exactly the app languages and both generated hosts', () => {
  expect(Object.keys(copies).sort()).toEqual(appLanguages.sort());
  for (const [lang, copy] of Object.entries(copies)) {
    expect(Object.keys(copy).sort()).toEqual(Object.keys(copies.en).sort());
    expect(Object.keys(copy.scenarios)).toEqual(Object.keys(copies.en.scenarios));
    for (const [id, scenario] of Object.entries(copy.scenarios)) {
      expect(scenario.steps).toHaveLength(copies.en.scenarios[id].steps.length);
      for (const value of [scenario.title, ...scenario.steps]) expect(value.trim().length).toBeGreaterThan(0);
      if (lang !== 'en') {
        expect(scenario.title).not.toBe(copies.en.scenarios[id].title);
        scenario.steps.forEach((step, index) => expect(step).not.toBe(copies.en.scenarios[id].steps[index]));
      }
    }
  }
  execFileSync(process.execPath, ['scripts/support/generate-passkey-guide.mjs', '--check']);
  expect(readFileSync('site/passkey-guide.js', 'utf8')).toBe(readFileSync('public/passkey-guide.js', 'utf8'));
});

for (const host of ['site', 'public']) {
  test(`@public-smoke ${host} recovery steps in all languages, mobile layout and direct links`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await serve(page, host);
    await page.setViewportSize({ width: 320, height: 720 });
    for (const [lang, copy] of Object.entries(copies)) {
      await page.goto(`http://localhost:5173/support.html?lang=${lang}#passkey-apple-to-android-qr`);
      const guide = page.locator('#section-1');
      await expect(guide).toHaveAttribute('lang', lang);
      await expect(guide).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expect(guide.locator('h2')).toHaveText(copy.title);
      await expect(page.locator('#gys-language')).toHaveValue(lang);
      await expect(guide.locator('#passkey-apple-to-android-qr')).toHaveAttribute('open', '');
      await expect(guide.locator('details')).toHaveCount(8);
      for (const [id, scenario] of Object.entries(copy.scenarios)) {
        const detail = guide.locator(`#passkey-${id}`);
        await expect(detail.locator('summary')).toHaveText(scenario.title);
        await expect(detail.locator('li')).toHaveText(scenario.steps);
      }
      await expect(guide).toContainText(copy.safety);
      // Test the expanded text, including Tamil/Thai line breaking and Arabic RTL.
      await guide.locator('details').evaluateAll(elements => elements.forEach(element => { (element as HTMLDetailsElement).open = true; }));
      expect(await guide.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(guide.locator('a[href="#contact"]')).toHaveText(copy.contact);
    }
    await page.locator('#gys-language').selectOption('ar');
    await expect(page.locator('#section-1')).toHaveAttribute('dir', 'rtl');
    await page.locator('#gys-language').selectOption('en');
    await expect(page.locator('#section-1')).toHaveAttribute('dir', 'ltr');
    await page.locator('#gys-language').selectOption('ta');
    await page.goto('http://localhost:5173/support.html');
    await expect(page.locator('#section-1')).toHaveAttribute('lang', 'ta');
    await page.goto('http://localhost:5173/support.html?lang=unsupported');
    await expect(page.locator('#section-1')).toHaveAttribute('lang', 'en');
    // Native details work with keyboard and the old recovery link remains valid.
    await page.locator('#passkey-lost-device summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#passkey-lost-device')).toHaveAttribute('open', '');
    expect(errors).toEqual([]);
  });

  test(`@public-smoke ${host} keeps recovery help without storage or JavaScript`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await serve(page, host);
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('blocked'); } }); });
    await page.goto('http://localhost:5173/support.html?lang=ar#passkey-lost-device');
    await expect(page.locator('#section-1')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('#passkey-lost-device')).toHaveAttribute('open', '');
    await context.close();
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const fallback = await noJs.newPage();
    await serve(fallback, host);
    await fallback.goto('http://localhost:5173/support.html');
    await expect(fallback.locator('#section-1 details')).toHaveCount(8);
    await expect(fallback.locator('#passkey-google-to-iphone li')).toHaveText(copies.en.scenarios['google-to-iphone'].steps);
    await fallback.locator('#passkey-lost-device summary').click();
    await expect(fallback.locator('#passkey-lost-device li').first()).toBeVisible();
    await noJs.close();
  });
}
