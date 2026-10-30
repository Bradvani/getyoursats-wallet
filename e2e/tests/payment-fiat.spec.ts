import {test,expect} from '@playwright/test';
const fixture='/e2e/fixtures/payment-fiat.html';
test('confirmation shows selected INR for total including the network fee',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(fixture);
 await expect(page.getByTestId('payment-fiat-amount')).toHaveText('≈ ₹81.45 INR');
 await expect(page.getByTestId('send-confirm-button')).toBeEnabled();
 await page.screenshot({path:'test-artifacts/fiat-pay-inr.png'});
 await page.goto(fixture+'?feesIncluded');await expect(page.getByTestId('payment-fiat-amount')).toHaveText('≈ ₹81.00 INR');
});
for(const [currency,value] of [['USD','≈ $0.90 USD'],['EUR','≈ €0.81 EUR'],['JPY','≈ ￥135 JPY']])test(`payment fiat uses ${currency} rather than hard-coded dollars`,async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('gys:language:v1','en'));
 await page.goto(`${fixture}?screen=sent&currency=${currency}`);
 await expect(page.getByTestId('payment-fiat-amount')).toHaveText(value);
});
for(const [width,height] of [[390,844],[320,568],[844,390]])for(const direction of ['sent','received'])test(`${direction} money leads progress at ${width}x${height}`,async({page,browserName})=>{
 await page.setViewportSize({width,height});await page.goto(`${fixture}?screen=${direction}`);
 const scene=page.getByTestId('transfer-experience'),amount=page.getByTestId('transfer-amount'),fiat=page.getByTestId('payment-fiat-amount');
 await expect(amount).toHaveText(direction==='received'?'27 sats':'900 sats');
 await expect(fiat).toHaveText(direction==='received'?'≈ ₹2.43 INR':'≈ ₹81.00 INR');
 await expect(scene).not.toContainText('Completed steps, not elapsed time');
 const layout=await page.evaluate(()=>{
  const amount=document.querySelector('[data-testid="transfer-amount"]')!,fiat=document.querySelector('[data-testid="payment-fiat-amount"]')!,progress=document.querySelector('[data-testid="transfer-percentage"]')!;
  const ab=amount.getBoundingClientRect(),fb=fiat.getBoundingClientRect(),pb=progress.getBoundingClientRect();
  return {amountSize:parseFloat(getComputedStyle(amount).fontSize),progressSize:parseFloat(getComputedStyle(progress).fontSize),ordered:ab.top<fb.top&&fb.top<pb.top,within:ab.left>=0&&ab.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth};
 });
 expect(layout.amountSize).toBeGreaterThan(layout.progressSize*2);expect(layout.ordered).toBe(true);expect(layout.within).toBe(true);
 await expect(page.getByRole('button',{name:'Done',exact:true})).toBeInViewport();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
 if(width===390){await expect(scene).toHaveAttribute('data-full-orange','true',{timeout:7000});await page.screenshot({path:`test-artifacts/fiat-${direction}-${browserName}.png`});}
});
test('missing selected-currency quote remains explicit, not a fallback estimate',async({page})=>{
 await page.goto(fixture+'?missingRate');await expect(page.getByTestId('payment-fiat-amount')).toHaveText('INR · Rate unavailable');
 await expect(page.getByTestId('send-confirm-button')).toBeEnabled();
});
