import {test,expect} from '@playwright/test';
const fixture='/e2e/fixtures/transfer-pulse.html';
for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
 for(const direction of ['send','receive'])test(`${direction}: one bright burst and an orange finish at ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto(fixture);
  await page.getByTestId(`preview-${direction}`).click();
  const view=page.getByTestId('transfer-experience');
  await expect(view).toHaveAttribute('data-direction',direction==='send'?'sent':'received');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','25');
  const mark=page.locator('.gys-contour-mark');
  await expect(mark.locator('image,img,filter,animate')).toHaveCount(0);
  const before=await mark.boundingBox();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','75');
  await expect(page.locator('.gys-sequence__wave')).toHaveCount(6);
  await expect(page.locator('.gys-sequence__wave').first()).toHaveCSS('stroke-width','5px');
  await expect(page.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
  await page.screenshot({path:`test-artifacts/sequence-${direction}-${viewport.width}-pending.png`});
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100',{timeout:5000});
  await expect(view).toHaveAttribute('data-full-orange','true',{timeout:12000});
  const after=await mark.boundingBox();expect(after).toEqual(before);
  await expect(mark).toHaveAttribute('data-bitcoin-fill',direction==='send'?'0.000':'1.000');
  const finalPath=await page.getByTestId('sequence-orange-fill').getAttribute('d');
  await page.waitForTimeout(1200);
  expect(await page.getByTestId('sequence-orange-fill').getAttribute('d')).toBe(finalPath);
  await page.screenshot({path:`test-artifacts/sequence-${direction}-${viewport.width}-confirmed.png`});
  await page.getByRole('button',{name:'Done',exact:true}).click();await expect(view).toHaveCount(0);
 });
}
for(const phase of ['failed','unknown'])test(`${phase} freezes the sequence before full orange and never displays 100%`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(fixture);
 await page.getByTestId('manual-send').click();await page.getByTestId('stage-processing').click();
 await page.waitForTimeout(1600);await page.getByTestId(`stage-${phase}`).click();
 const view=page.getByTestId('transfer-experience');await expect(view).toHaveAttribute('data-stopped','true');
 const stopped=await view.getAttribute('data-visual-progress');await page.waitForTimeout(2400);
 expect(await view.getAttribute('data-visual-progress')).toBe(stopped);
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
 await expect(page.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
 await expect(page.getByRole('alert')).toHaveText(phase==='failed'?'Payment failed':'Payment status unknown');
 await page.screenshot({path:`test-artifacts/sequence-${phase}.png`});
});
test('pending holds its checkpoint and its shape without looping',async({page})=>{
 await page.goto(fixture);await page.getByTestId('manual-receive').click();await page.getByTestId('stage-confirming').click();
 const view=page.getByTestId('transfer-experience');await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','75');
 await expect(view).toHaveAttribute('data-visual-progress','0.6600',{timeout:10000});
 const line=await page.locator('.gys-sequence__wave').first().getAttribute('d');await page.waitForTimeout(1800);
 expect(await page.locator('.gys-sequence__wave').first().getAttribute('d')).toBe(line);
 await expect(page.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
});
test('reduced motion preserves the percentage and status without a screen sweep',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(fixture);await page.getByTestId('manual-send').click();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','25');
 await expect(page.locator('.gys-sequence__canvas')).toBeHidden();
 await page.getByTestId('stage-confirmed').click();await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
 await expect(page.getByTestId('sequence-orange-fill')).toHaveAttribute('opacity','0');
});
test('explicit vibration and definite failure remain independent of the motion clock',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:(p:unknown)=>{(window as unknown as {patterns:unknown[]}).patterns.push(p);return true;}});
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:true}});
  (window as unknown as {patterns:unknown[]}).patterns=[];
 });
 await page.goto(fixture);await page.getByRole('button',{name:'Test vibration',exact:true}).click();
 await page.getByTestId('manual-send').click();await page.getByTestId('stage-failed').click();
 expect(await page.evaluate(()=>(window as unknown as {patterns:unknown[]}).patterns)).toEqual([120,[80,60,100]]);
});
test('high pixel density keeps a stationary vector-only logo and orange isolated to B',async({browser,browserName})=>{
 const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:3,hasTouch:true,...(browserName==='firefox'?{}:{isMobile:true})});
 const page=await context.newPage();await page.goto(fixture);await page.getByTestId('manual-receive').click();await page.getByTestId('stage-confirming').click();
 const logo=page.locator('.gys-contour-mark');await expect(logo.locator('image,img')).toHaveCount(0);
 await expect(logo).toHaveCSS('filter','none');await expect(logo).toHaveCSS('animation-name','none');
 expect(await logo.locator('[fill="#F7931A"]').count()).toBe(1);
 await page.waitForTimeout(1400);await page.screenshot({path:`test-artifacts/sequence-${browserName}-density3.png`});await context.close();
});

