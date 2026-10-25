import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';

const fixture='http://localhost:5173/e2e/fixtures/premium-ui.html';
const seedTheme=async (page: import('@playwright/test').Page)=>{
 await page.addInitScript(()=>localStorage.setItem('gys:appearance:v1','orange'));
};
const contrast=(foreground:string,background:string):number=>{
 const values=(v:string)=>v.match(/[\d.]+/g)!.slice(0,3).map(Number);
 const luminance=(v:string)=>{
  const [r,g,b]=values(v).map(n=>{const x=n/255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)});
  return r*.2126+g*.7152+b*.0722;
 };
 const a=luminance(foreground),b=luminance(background);
 return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};

test('@public-smoke Orange surfaces are readable at desktop and mobile sizes',async({page})=>{
 await seedTheme(page);
 for(const [width,height] of [[390,844],[1365,900],[320,650]]){
  await page.setViewportSize({width,height});
  await page.goto(fixture);
  await expect(page.getByTestId('wallet-balance')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-gys-theme','orange');
  const styles=await page.evaluate(()=>{
   const get=(selector:string)=>{
    const element=document.querySelector(selector);
    if(!element)throw new Error('Missing '+selector);
    const style=getComputedStyle(element);
    return {color:style.color,background:style.backgroundColor,image:style.backgroundImage,opacity:style.opacity};
   };
   return {
    balance:get('.gys-wallet-balance-surface__content .balance-display'),
    hero:get('.gys-wallet-balance-surface__content'),
    veil:get('.gys-wallet-balance-surface__veil'),
    walletLogo:get('.gys-wallet-balance-surface__toolbar .gys-brand-wordmark--compact'),
    merchant:get('.gys-home-quick-actions__button:not(:disabled)'),
    merchantTitle:get('.gys-home-quick-actions__button:not(:disabled) strong'),
    recurring:get('.gys-home-quick-actions__button:disabled'),
    recurringTitle:get('.gys-home-quick-actions__button:disabled strong'),
    receive:get('.gys-action-dock__receive'),
    send:get('.gys-action-dock__send'),
    activity:get('.gys-activity'),
    activityTitle:get('.gys-activity__heading h2'),
    unit:get('.gys-unit-switch button[aria-pressed="true"]'),
   };
  });
  expect(contrast(styles.balance.color,styles.hero.background)).toBeGreaterThan(7);
  expect(contrast(styles.merchantTitle.color,styles.merchant.background)).toBeGreaterThan(7);
  expect(contrast(styles.recurringTitle.color,styles.recurring.background)).toBeGreaterThan(4.5);
  expect(contrast(styles.receive.color,styles.receive.background)).toBeGreaterThan(4.5);
  expect(contrast(styles.send.color,styles.send.background)).toBeGreaterThan(4.5);
  expect(contrast(styles.unit.color,styles.unit.background)).toBeGreaterThan(4.5);
  expect(styles.veil.background).not.toBe('rgb(11, 11, 11)');
  expect(styles.activity.image).toContain('gradient');
  await expect(page.locator('.gys-wallet-balance-surface__toolbar img.gys-brand-wordmark--compact'))
    .toHaveAttribute('src','/brand/wordmark-horizontal-light.svg');
  await expect(page.getByRole('button',{name:'Send Bitcoin'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Receive Bitcoin'})).toBeVisible();
  if(width<=720){
   // The compact action dock intentionally keeps only Send / Receive.
   await expect(page.getByRole('button',{name:'Open Point of Sale'})).toBeVisible();
   await expect(page.getByRole('button',{name:'Accept a payment in merchant mode'})).toBeHidden();
   await expect(page.getByRole('button',{name:'Scan payment QR'})).toBeHidden();
  }else{
   await expect(page.getByRole('button',{name:'Scan payment QR'})).toBeVisible();
   await expect(page.getByRole('button',{name:'Accept a payment in merchant mode'})).toBeVisible();
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  expect(overflow).toBe(false);
  mkdirSync('test-artifacts',{recursive:true});
  await page.screenshot({path:`test-artifacts/orange-wallet-${width}.png`,animations:'disabled'});
 }
});

test('@public-smoke Orange POS starts at a blank charge even with a previous completed-looking local invoice',async({page})=>{
 await seedTheme(page);
 await page.addInitScript(()=>{
   const invoice='lnbc1'+'a'.repeat(90);
   const order={id:'saved-old-pos',invoice,amountSats:100,unit:'sats',description:'Previously issued order',
     createdAt:Date.now()-60000,feeSats:0};
   localStorage.setItem('gys:merchant:orders:v1:'+'a'.repeat(66),JSON.stringify([order]));
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture);
 await page.getByRole('button',{name:'Open Point of Sale'}).click();
 const pos=page.getByRole('dialog',{name:'Merchant point of sale'});
 await expect(pos).toBeVisible();
 await expect(pos.getByText('Amount to charge')).toBeVisible();
 await expect(pos.getByRole('button',{name:'Charge',exact:true})).toBeVisible();
 await expect(pos.getByText('Payment received')).toHaveCount(0);
 await expect(pos.getByText('Previously issued order')).toHaveCount(0);
 await expect(page.getByTestId('pos-invoice-qr')).toHaveCount(0);
 const colors=await page.evaluate(()=>{
   const panel=getComputedStyle(document.querySelector('.gys-pos-terminal')!);
   const btn=getComputedStyle(document.querySelector('.gys-pos-terminal__keypad button')!);
   return {panelColor:panel.color,panelBg:panel.backgroundColor,button:btn.color,buttonBg:btn.backgroundColor};
 });
 expect(contrast(colors.panelColor,colors.panelBg)).toBeGreaterThan(7);
 expect(contrast(colors.button,colors.buttonBg)).toBeGreaterThan(7);
 await page.screenshot({path:'test-artifacts/orange-pos-fresh.png',animations:'disabled'});
 await pos.getByRole('button',{name:'Payment history'}).click();
 await expect(pos.getByText('Previously issued order',{exact:false})).toBeVisible();
 await pos.getByRole('button',{name:/100 sats · Previously issued order/}).click();
 await expect(pos.getByText('Scan to pay')).toBeVisible();
 await pos.getByRole('button',{name:'New charge'}).click();
 await expect(pos.getByText('Amount to charge')).toBeVisible();
 await expect(pos.getByText('Previously issued order')).toHaveCount(0);
 await pos.getByRole('button',{name:'Close point of sale'}).click();
 await page.getByRole('button',{name:'Open Point of Sale'}).click();
 await expect(pos.getByText('Amount to charge')).toBeVisible();
 await expect(pos.getByText('Payment received')).toHaveCount(0);
});

test('@public-smoke Orange Settings, Menu and forms retain clear labels',async({page})=>{
 await seedTheme(page);
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture+'?screen=settings');
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 await expect(page.getByTestId('settings-appearance-orange')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('settings-appearance-dark')).toBeVisible();
 await expect(page.getByTestId('settings-appearance-system')).toBeVisible();
 await expect(page.getByTestId('settings-language-en')).toBeVisible();
 await expect(page.getByRole('button',{name:/Currencies/i})).toBeVisible();
 await page.screenshot({path:'test-artifacts/orange-settings.png',animations:'disabled'});
 // The isolated fixture has no #content-root drawer anchor; main Settings controls are tested above.
 // Menu rendering is covered in the real wallet integration, not this isolated payment fixture.
});
