import {expect, test} from '@playwright/test';

test('@public-smoke Privacy Notice serves branded, accessible beta guidance', async ({page}) => {
  const response = await page.goto('http://localhost:5173/privacy.html');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle('Privacy Notice | GetYourSats');
  await expect(page.getByRole('heading', {level: 1})).toContainText('Your wallet.');
  await expect(page.getByText('Never share a recovery phrase', {exact: false})).toBeVisible();
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', '/legal.css');
  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('a[href="mailto:getyoursats@gmail.com"]')).toHaveCount(1);
  await expect(page.getByText('Privacy policy is pending review.')).toHaveCount(0);
  await page.getByRole('navigation', {name: 'Main navigation'})
    .getByRole('link', {name: 'Support'}).click();
  await expect(page).toHaveURL(/\/support\.html$/);
});

test('@public-smoke Support page offers safe contact and realistic recovery advice', async ({page}) => {
  const response = await page.goto('http://localhost:5173/support.html');
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle('Wallet Support | GetYourSats');
  await expect(page.getByRole('heading', {level: 1})).toContainText('Support that puts');
  await expect(page.getByRole('link', {name: /Email GetYourSats support/}))
    .toHaveAttribute('href', 'mailto:getyoursats@gmail.com?subject=GetYourSats%20wallet%20support');
  await expect(page.getByText('Support channel pending setup.')).toHaveCount(0);
  await expect(page.getByText('We will never ask for your recovery phrase', {exact: false})).toBeVisible();
});

test('@public-smoke trust pages do not overflow mobile or disable zoom', async ({page}) => {
  await page.setViewportSize({width: 375, height: 812});
  for (const path of ['/privacy.html', '/support.html', '/']) {
    await page.goto('http://localhost:5173' + path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).not.toContain('user-scalable=no');
    expect(viewport).not.toContain('maximum-scale=1');
  }
  await expect(page.locator('meta[name="theme-color"]:not([media])')).toHaveAttribute('content', '#050505');
});
