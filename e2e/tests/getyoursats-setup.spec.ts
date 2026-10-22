import {test,expect} from '@playwright/test';

test('@public-smoke wallet setup fails closed without a Breez SDK key',async({page})=>{
  await page.goto('http://localhost:5173/');
  const start=page.getByRole('button',{name:/^Start/});
  await expect(start).toBeVisible({timeout:30000});
  await start.click();
  await expect(page.getByRole('alert')).toContainText('Wallet setup is temporarily unavailable');
  await expect(page.getByText('Recovery Phrase',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Restore existing wallet'})).toBeVisible();
});
