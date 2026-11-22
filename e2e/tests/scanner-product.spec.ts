import {test,expect} from '@playwright/test';

for(const theme of ['orange','dark']) for(const width of [320,390,1440]) {
  test(`branded scanner controls stay reachable in ${theme} at ${width}px`,async({page},testInfo)=>{
    await page.setViewportSize({width,height:width===320?568:844});
    await page.goto(`/e2e/fixtures/scanner-review.html?theme=${theme}&lang=en`);
    const scanner=page.getByTestId('scanner-portrait');
    await expect(scanner.getByRole('img',{name:'GetYourSats'})).toBeVisible();
    await expect(scanner.getByRole('heading',{name:'Scan QR'})).toBeVisible();
    await expect(scanner.getByRole('status')).toContainText('Point camera at QR code');
    for(const name of ['Cancel','Pick image from gallery','Turn torch on','Switch camera']){
      const control=scanner.getByRole('button',{name,exact:true});
      await expect(control).toBeInViewport({ratio:1});
      const box=await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const geometry=await scanner.evaluate(el=>{
      const camera=el.querySelector('.gys-scanner-camera')!.getBoundingClientRect();
      const target=el.querySelector('.gys-scanner-target')!.getBoundingClientRect();
      return {overflow:el.scrollWidth>el.clientWidth+1,cameraWidth:camera.width,cameraHeight:camera.height,
        targetWidth:target.width,targetHeight:target.height};
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.cameraWidth).toBeGreaterThan(150);
    expect(Math.abs(geometry.cameraWidth-geometry.cameraHeight)).toBeLessThan(1);
    expect(Math.abs(geometry.targetWidth-geometry.cameraWidth*2/3)).toBeLessThan(1);
    expect(Math.abs(geometry.targetWidth-geometry.targetHeight)).toBeLessThan(1);
    await scanner.getByRole('button',{name:'Turn torch on'}).click();
    await expect(scanner.getByRole('button',{name:'Turn torch off'})).toHaveAttribute('aria-pressed','true');
    await page.screenshot({path:testInfo.outputPath(`scanner-${theme}-${width}.png`)});
    await scanner.getByRole('button',{name:'Cancel'}).click();
    await expect(scanner).toHaveCount(0);
  });
}

test('denied camera keeps gallery and retry usable at 320px with enlarged text',async({page},testInfo)=>{
  await page.setViewportSize({width:320,height:568});
  await page.goto('/e2e/fixtures/scanner-review.html?denied&theme=orange&lang=en');
  await page.addStyleTag({content:'html{font-size:32px!important}'});
  const scanner=page.getByTestId('scanner-portrait');
  await expect(scanner.getByRole('status')).toContainText('Camera not available');
  await expect(scanner.getByText('Camera access is blocked.',{exact:false})).toBeVisible();
  const gallery=scanner.getByRole('button',{name:'Pick image from gallery'});
  await gallery.scrollIntoViewIfNeeded();await expect(gallery).toBeInViewport();await expect(gallery).toBeEnabled();
  const retry=scanner.getByRole('button',{name:'Try again'});
  await retry.scrollIntoViewIfNeeded();await retry.click();
  await expect(scanner.getByRole('status')).toContainText('Camera not available');
  expect(await scanner.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('scanner-camera-denied-large-text.png')});
  const close=scanner.getByRole('button',{name:'Cancel'});
  await close.scrollIntoViewIfNeeded();await close.click();await expect(scanner).toHaveCount(0);
});

for(const lang of ['hi','ta','ar','zh-CN'])test(`scanner labels reflow in ${lang} with reduced motion`,async({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:740});
  await page.goto(`/e2e/fixtures/scanner-review.html?theme=orange&lang=${lang}`);
  const scanner=page.getByTestId('scanner-portrait');
  await expect(scanner.locator('.gys-scanner-sweep')).toBeAttached();
  expect(await scanner.locator('.gys-scanner-sweep').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(await scanner.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if(lang==='ar')await expect(scanner).toHaveAttribute('dir','rtl');
  for(const control of await scanner.getByRole('button').all())await expect(control).toBeInViewport({ratio:1});
  await page.screenshot({path:testInfo.outputPath(`scanner-${lang}.png`)});
});
