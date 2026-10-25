import { test, expect, type Page } from '@playwright/test';
async function waitForScriptFont(page: Page, family: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          [...document.fonts].some(
            (font) =>
              font.family.replace(/"/g, '').includes(name) &&
              font.status === 'loaded'
          ),
        family
      )
    )
    .toBe(true);
}
for (const width of [360, 390, 768, 1024, 1366, 1920])
  for (const language of ['en', 'ar', 'ta'])
    test(`payment layout ${language} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((lang) => {
        localStorage.setItem('gys:language:v1', lang);
        localStorage.setItem('gys:appearance:v1', 'orange');
      }, language);
      await page.goto('/e2e/fixtures/payment-locales.html');
      await expect(page.getByTestId('lnurl-available-balance')).toHaveText(
        '2 049 sats'
      );
      await expect(page.locator('#lnurl-amount')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(
        'dir',
        language === 'ar' ? 'rtl' : 'ltr'
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      if (language === 'ar') await waitForScriptFont(page, 'Noto Sans Arabic');
      if (language === 'ta') await waitForScriptFont(page, 'Noto Sans Tamil');
      await page.locator('#lnurl-amount').fill('2000');
      await page.locator('#lnurl-comment').scrollIntoViewIfNeeded();
      await expect(page.locator('#lnurl-comment')).toBeVisible();
      await page.screenshot({
        path: `test-artifacts/payment-${language}-${width}.png`,
      });
    });
test('language picker supports search, keyboard selection, persistence and RTL reset', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/payment-locales.html?languages');
  const input = page.getByRole('combobox');
  await input.fill('Thai');
  await expect(page.getByRole('option')).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await page.reload();
  await expect(page.getByRole('combobox')).toHaveValue('ไทย');
  await page.getByRole('combobox').fill('Arabic');
  await page.getByRole('option').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('combobox').fill('English');
  await page.getByRole('option').click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
test('Settings uses a compact dropdown with all ten languages', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/premium-ui.html?screen=settings');
  await page
    .getByRole('combobox', { name: 'Language' })
    .scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(10);
  await page.screenshot({ path: 'test-artifacts/language-settings.png' });
});

for (const [language, font] of [
  ['ja', 'Noto Sans JP'],
  ['th', 'Noto Sans Thai'],
  ['vi', 'Plus Jakarta Sans'],
  ['hi', 'Noto Sans Devanagari'],
  ['zh-CN', 'Noto Sans SC'],
])
  test(`script font and payment layout ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (lang) => localStorage.setItem('gys:language:v1', lang),
      language
    );
    await page.goto('/e2e/fixtures/payment-locales.html');
    await expect(page.getByTestId('lnurl-available-balance')).toHaveText(
      '2 049 sats'
    );
    await waitForScriptFont(page, font);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/payment-${language}-390.png`,
    });
  });
for (const width of [390, 1366])
  test(`Arabic Settings navigation ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      localStorage.setItem('gys:language:v1', 'ar')
    );
    await page.goto('/e2e/fixtures/premium-ui.html?screen=settings');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const input = page.getByRole('combobox', { name: 'اللغة' });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toHaveValue('العربية');
    await input.fill('Chinese');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.screenshot({ path: `test-artifacts/settings-ar-${width}.png` });
    await input.press('Escape');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    if (width >= 1024) {
      const nav = page.locator('.gys-desktop-nav');
      const box = await nav.boundingBox();
      expect(box!.x).toBeGreaterThan(width - 250);
      await nav.getByRole('button').first().click();
      await expect(page.getByTestId('send-button')).toBeVisible();
    }
  });

test('Latin wallet payment defers script font styles until needed', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/e2e/fixtures/payment-locales.html');
  await expect(page.getByTestId('lnurl-available-balance')).toHaveText(
    '2 049 sats'
  );
  expect(requests.some((url) => url.includes('/locales/fonts.css'))).toBe(
    false
  );
});
