import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';

const url='http://localhost:5173/site/index.html';
test.beforeEach(async({page})=>{
  await page.route('**/assets/networks/*.png',route=>route.fulfill({
    contentType:'image/png',body:readFileSync('site/assets/networks/'+new URL(route.request().url()).pathname.split('/').pop())
  }));
  await page.route('**/experience-v5.js*',route=>route.fulfill({
    contentType:'application/javascript',body:readFileSync('site/experience-v5.js','utf8')
  }));
  await page.route('**/experience-v5.css*',route=>route.fulfill({
    contentType:'text/css',body:readFileSync('site/experience-v5.css','utf8')
  }));
});
const networkNames=['Ethereum','Solana','Base','BNB Chain','Arbitrum','TRON'];
for(const [width,height] of [[1440,900],[1024,800],[390,844],[320,700]]){
  test(`@public-smoke logos form a balanced editorial gallery at ${width}px`,async({page})=>{
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setViewportSize({width,height});
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#tab-lightning').click();
    const gallery=page.locator('#features .ex-network-showcase');
    await expect(gallery).toBeVisible();
    const chips=gallery.locator('.ex-chain-chip');
    await expect(chips).toHaveCount(networkNames.length);
    for(let index=0;index<networkNames.length;index++){
      const chip=chips.nth(index);
      await expect(chip.locator('.ex-chain-label')).toHaveText(networkNames[index]);
      await expect(chip.locator('img')).toBeVisible();
      await expect.poll(()=>chip.locator('img').evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    const measures=await chips.evaluateAll(elements=>elements.map(element=>{
      const rect=element.getBoundingClientRect();
      const mark=element.querySelector('.ex-chain-mark')!;
      const icon=mark.getBoundingClientRect();
      const label=element.querySelector('.ex-chain-label')!;
      const style=getComputedStyle(element),text=getComputedStyle(label);
      return {
        x:rect.left,y:Math.round(rect.top),w:rect.width,h:rect.height,
        iconWidth:icon.width,iconHeight:icon.height,
        noTextClipping:label.scrollWidth<=label.clientWidth+1,
        nowrap:text.whiteSpace==='nowrap',
        borderStyle:style.borderStyle,
        borderColor:style.borderColor,
        background:style.backgroundColor
      };
    }));
    expect(measures.every(m=>m.noTextClipping&&m.nowrap)).toBe(true);
    expect(new Set(measures.map(m=>Math.round(m.iconWidth))).size).toBe(1);
    expect(new Set(measures.map(m=>Math.round(m.iconHeight))).size).toBe(1);
    expect(new Set(measures.map(m=>Math.round(m.w))).size).toBe(1);
    const rows=[...new Set(measures.map(m=>m.y))];
    expect(rows.length).toBeLessThanOrEqual(2);
    if(rows.length===2){
      const first=measures.filter(m=>m.y===rows[0]);
      const second=measures.filter(m=>m.y===rows[1]);
      expect(first).toHaveLength(3);
      expect(second).toHaveLength(3);
      const center=(a:typeof measures)=>(Math.min(...a.map(m=>m.x))+Math.max(...a.map(m=>m.x+m.w)))/2;
      expect(Math.abs(center(first)-center(second))).toBeLessThanOrEqual(2);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    expect(errors).toEqual([]);
    mkdirSync('test-artifacts',{recursive:true});
    await gallery.screenshot({path:`test-artifacts/network-gallery-${width}.png`,animations:'disabled'});
  });
}
