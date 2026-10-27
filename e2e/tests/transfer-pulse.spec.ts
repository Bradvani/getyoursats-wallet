import {test,expect} from '@playwright/test';
for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
 for(const direction of ['sent','received'])test(`${direction}: slow transparent logo-anchored contours at ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/e2e/fixtures/transfer-pulse.html');
  await page.getByTestId(`preview-${direction}`).click();const pulse=page.getByTestId('transfer-pulse');
  await expect(pulse).toHaveAttribute('data-direction',direction);await expect(pulse).toHaveCSS('pointer-events','none');
  await expect(pulse).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const box=await pulse.boundingBox();expect(box?.width).toBe(viewport.width);expect(box?.height).toBe(viewport.height);
  await expect(pulse.locator('.gys-pulse__contour')).toHaveCount(6);await expect(pulse.locator('img,image')).toHaveCount(0);
  await expect.poll(()=>pulse.locator('.gys-pulse__contour').first().getAttribute('d')).not.toBeNull();
  await page.waitForTimeout(1600);await expect(pulse).toBeAttached();
  const geometry=await page.evaluate(()=>{
   const logo=document.querySelector('.gys-contour-mark')!.getBoundingClientRect();
   const cut=document.querySelector('mask rect[fill="black"]')!;
   return {logo:{x:logo.x,y:logo.y,w:logo.width},mask:{x:Number(cut.getAttribute('x')),y:Number(cut.getAttribute('y')),w:Number(cut.getAttribute('width'))}};
  });
  expect(geometry.mask.x).toBeCloseTo(geometry.logo.x,0);expect(geometry.mask.y).toBeCloseTo(geometry.logo.y,0);expect(geometry.mask.w).toBeCloseTo(geometry.logo.w,0);
  await page.screenshot({path:`test-artifacts/contours-${direction}-${viewport.width}.png`});
  await expect(page.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
  await expect(pulse).toHaveCount(0,{timeout:5000});
 });
}
test('pending never invents a percentage or auto-completes',async({page})=>{
 await page.goto('/e2e/fixtures/transfer-pulse.html');await page.getByTestId('preview-pending').click();
 await expect(page.getByTestId('transfer-flow')).toBeAttached();await page.waitForTimeout(6000);
 await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');await expect(page.getByText('100%',{exact:true})).toHaveCount(0);
 await page.getByTestId('preview-sent').click();await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
});
test('unsupported vibration is not shown as delivered',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true}));
 await page.goto('/e2e/fixtures/transfer-pulse.html');await expect(page.getByRole('button',{name:'Test vibration',exact:true})).toBeDisabled();
 await expect(page.getByText('This browser does not expose vibration. Visual feedback stays on.')).toBeVisible();
});
test('explicit vibration test and definite error use distinct patterns',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:(pattern:unknown)=>{(window as unknown as {patterns:unknown[]}).patterns.push(pattern);return true;}});
  Object.defineProperty(navigator,'userActivation',{configurable:true,value:{hasBeenActive:true}});
  (window as unknown as {patterns:unknown[]}).patterns=[];
 });
 await page.goto('/e2e/fixtures/transfer-pulse.html');await page.getByRole('button',{name:'Test vibration',exact:true}).click();
 await expect(page.getByText(/Request accepted/)).toBeVisible();await page.getByTestId('preview-failed').click();
 expect(await page.evaluate(()=>(window as unknown as {patterns:unknown[]}).patterns)).toEqual([120,[80,60,100]]);
 await expect(page.getByTestId('transfer-pulse')).toHaveCount(0);
});
test('reduced motion has no travelling contours',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/e2e/fixtures/transfer-pulse.html');
 await page.getByTestId('preview-pending').click();await expect(page.locator('.gys-pulse__contours')).toBeHidden();
 await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
});
