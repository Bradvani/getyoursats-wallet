import {test,expect} from '@playwright/test';
for(const viewport of [{width:390,height:844},{width:1366,height:900}]){
 for(const direction of ['sent','received'])test(`${direction} pulse covers viewport without intercepting controls at ${viewport.width}`,async({page})=>{
  await page.setViewportSize(viewport);await page.goto('/e2e/fixtures/transfer-pulse.html');
  await expect(page.getByTestId('transfer-pulse')).toHaveCount(0);
  await page.getByRole('button',{name:direction,exact:true}).click();
  const pulse=page.getByTestId('transfer-pulse');
  await expect(pulse).toHaveAttribute('data-direction',direction);
  await expect(pulse).toHaveCSS('pointer-events','none');
  const box=await pulse.boundingBox();expect(box?.width).toBe(viewport.width);expect(box?.height).toBe(viewport.height);
  // Stop only the decorative animation for reproducible visual evidence.
  await pulse.evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=570}));
  await page.screenshot({path:`test-artifacts/pulse-${direction}-${viewport.width}.png`});
  await expect(page.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
  await expect(pulse).toHaveCount(0,{timeout:4000});
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sending',exact:true})).toBeVisible();
 });
}
test('unknown and failed states never animate success, and haptics can be disabled',async({page})=>{
 await page.goto('/e2e/fixtures/transfer-pulse.html');
 for(const state of ['unknown','failed']){
  await page.getByRole('button',{name:state,exact:true}).click();
  await expect(page.getByTestId('transfer-pulse')).toHaveCount(0);
 }
 await page.getByRole('switch',{name:'Payment haptics'}).uncheck();
 expect(await page.evaluate(()=>localStorage.getItem('gys:payment-haptics:v1'))).toBe('off');
});
test('reduced motion has no screen travel, and late motion never changes settlement',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/e2e/fixtures/transfer-pulse.html');
 await page.getByRole('button',{name:'sent',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Payment Sent!'})).toBeVisible();
 await expect(page.getByTestId('transfer-pulse')).toHaveCount(0,{timeout:2000});
 await expect(page.getByTestId('sent-payment-amount')).toHaveText('5 000 sats');
});
