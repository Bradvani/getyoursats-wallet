import {test, expect} from '@playwright/test';
const fixture = '/e2e/fixtures/premium-ui.html';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('gys:language:v1', 'en');
    if (!localStorage.getItem('fiat_settings_v1')) localStorage.setItem('fiat_settings_v1', JSON.stringify({selectedCurrencies:['USD']}));
  });
});

for (const width of [360, 1440]) test(`currency choice survives metadata failure and reload at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height:900});
  await page.goto(fixture + '?screen=currencies&metadataOffline');
  await expect(page.getByTestId('currency-USD').getByRole('checkbox')).toBeDisabled();
  const search = page.getByTestId('currency-search');
  await search.fill('₹');
  const inr = page.getByTestId('currency-INR');
  await inr.getByRole('checkbox').check();
  await inr.getByRole('button', {name:'Use as default: INR'}).click();
  await expect(page.getByTestId('currency-format-preview')).toContainText('₹12,34,567.89');
  await search.fill('no matching currency');
  await expect(page.getByTestId('currency-no-results')).toBeVisible();
  await search.clear();
  await expect(inr.getByRole('checkbox')).toBeChecked();
  const targets = await inr.getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return {width:rect.width, height:rect.height};
  }));
  for (const target of targets) {expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);}
  await page.screenshot({path:`test-artifacts/currency-settings-${width}.png`,fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto(fixture);
  await expect(page.getByTestId('market-quote-price')).toHaveText('₹75,00,000.00');
  await page.reload();
  await expect(page.getByTestId('market-quote-price')).toHaveText('₹75,00,000.00');
});

test('currency controls work with keyboard and at 200 percent CSS zoom', async ({page}) => {
  await page.setViewportSize({width:720,height:1100});
  await page.goto(fixture + '?screen=currencies');
  await page.evaluate(() => {document.documentElement.style.zoom = '2';});
  await page.getByTestId('currency-search').fill('INR');
  const checkbox = page.getByTestId('currency-INR').getByRole('checkbox');
  await checkbox.focus();await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  const use = page.getByTestId('currency-INR').getByRole('button',{name:'Use as default: INR'});
  await use.focus();await page.keyboard.press('Enter');
  await expect(use).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('guide sets currency in context without completing recovery', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:360,height:900});
  await page.goto('/e2e/fixtures/wallet-setup.html');
  const guide = page.getByTestId('wallet-setup-guide');
  await page.getByTestId('wallet-setup-next').click();
  await page.getByTestId('wallet-setup-next').click();
  await expect(guide).toHaveAttribute('data-wallet-tour-step','balance');
  await page.getByTestId('setup-currency').selectOption('INR');
  await expect(guide).toContainText('₹12,34,567.89');
  await expect(guide).toHaveAttribute('data-motion','reduced');
  await page.screenshot({path:'test-artifacts/onboarding-currency-mobile.png'});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('setup-currency')).toHaveValue('INR');
  const recovery = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('gys:wallet-setup:')).map(([,value]) => value));
  expect(recovery.join(' ')).not.toContain('phrase-verified');
});

test('INR receipt grouping is independent of interface language', async ({page}) => {
  await page.goto('/e2e/fixtures/payment-fiat.html?currency=INR&sats=100000000&lang=es');
  await expect(page.getByTestId('payment-fiat-amount')).toContainText('₹90,00,000.');
});

test('native currency controls load the selected script font and preserve RTL', async ({page}) => {
  await page.setViewportSize({width:360,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  for (const [language, font] of [['hi','Noto Sans Devanagari'],['ta','Noto Sans Tamil'],['ar','Noto Sans Arabic'],['zh-CN','Noto Sans SC']]) {
    await page.goto(`/e2e/fixtures/wallet-setup.html?lang=${language}`);
    const guide = page.getByTestId('wallet-setup-guide');
    for (let step = 0; step < 6 && await guide.getAttribute('data-wallet-tour-step') !== 'balance'; step++) await page.getByTestId('wallet-setup-next').click();
    const choice = page.getByTestId('setup-currency');
    await choice.selectOption('INR');
    await page.evaluate(() => document.fonts.ready);
    expect(await choice.evaluate(node => getComputedStyle(node).fontFamily)).toContain(font);
    expect(await page.evaluate(family => document.fonts.check(`16px "${family}"`), font)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-artifacts/currency-script-${language}.png`});
  }
});
