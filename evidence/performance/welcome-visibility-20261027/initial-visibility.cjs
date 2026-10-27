const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const requiredPath = name => {const value = process.env[name]; if (!value) throw new Error(name + ' is required'); return path.resolve(value);};
const {chromium} = require(requiredPath('GYS_PLAYWRIGHT_MODULE'));
const out = requiredPath('GYS_A13_OUTPUT');
const variants = [
  {name:'before', directory:requiredPath('GYS_A13_BEFORE_DIST')},
  {name:'after', directory:requiredPath('GYS_A13_AFTER_DIST')},
];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const safeUrl = value => {try {const u = new URL(value);return u.origin+u.pathname;}catch{return '[non-URL]';}};
fs.mkdirSync(out,{recursive:true});
const receipt = {schemaVersion:1,startedAt:new Date().toISOString(),scope:'Local built-candidate welcome visibility only',
  sourceBase:'6304e545149d53efa73f4580b869bba475b4fd68',viewport:{width:390,height:844},samples:[],
  limits:['Two cold samples, one before and one after, not a statistical performance estimate.',
    'Concurrent SDK Cargo compilation and uncontrolled host load can change wall-clock values.',
    'Local loopback HTTP static delivery, different SDK from public source07dd, not production network performance.',
    'No Start/Restore clicks or other wallet actions. No wallet-ready, physical-device or funded-flow claim.']};
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8',
 '.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png',
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
async function serve(directory){
 const server=http.createServer((req,res)=>{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  const relative=decodeURIComponent(pathname==='/'?'/index.html':pathname);
  const filename=path.resolve(directory,'.'+relative);
  if(!filename.startsWith(directory+path.sep)){res.writeHead(404).end();return;}
  fs.readFile(filename,(error,body)=>{
   if(error){res.writeHead(404).end();return;}
   res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'public, max-age=0, must-revalidate','Content-Length':body.length});
   res.end(req.method==='HEAD'?undefined:body);
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {server,origin:'http://127.0.0.1:'+server.address().port};
}
function instrumentation() {
  const state = window.__gysStartupLab = {timeOrigin:performance.timeOrigin,marks:{},longTasks:[],stops:[],wasm:[],brandCoverSeen:false};
  performance.setResourceTimingBufferSize(1000);
  const mark = name => {if(state.marks[name] === undefined) state.marks[name] = performance.now();};
  const stop = reason => {state.stops.push({reason,at:performance.now()}); throw new Error('READ_ONLY_LAB_STOP: '+reason);};
  // These guards are inert on ordinary public static startup. They prevent
  // accidental credential, operator-session or value-moving work. No routing
  // interception is used because it would disable the browser's HTTP cache.
  const allowed = (url,method) => {
    const u = new URL(url, location.href);
    if(!['GET','HEAD'].includes(method.toUpperCase())) stop('non-read request');
    if(u.origin !== location.origin || /^\/(?:api|\.well-known|lnurl)/.test(u.pathname)) stop('non-static connection');
  };
  const fetch = window.fetch;
  window.fetch = function(input,init) {
    allowed(typeof input==='string'||input instanceof URL?String(input):input.url,
      init?.method||(input instanceof Request?input.method:'GET'));
    return Reflect.apply(fetch,this,arguments);
  };
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method,url) {allowed(String(url),method);return Reflect.apply(xhrOpen,this,arguments);};
  if(window.WebSocket) window.WebSocket = new Proxy(window.WebSocket,{construct(){return stop('socket connection');}});
  if(navigator.credentials) {
    for(const method of ['create','get']) {
      try {Object.defineProperty(navigator.credentials,method,{value:()=>stop('credential '+method),configurable:true});} catch {}
    }
  }
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key,value) {
    if(/mnemonic|seed|credential|passkeyRegistered|passkeyLabel|passkeyRpId|wallet.*(?:secret|key|session)/i.test(String(key))) stop('sensitive storage write');
    return Reflect.apply(setItem,this,arguments);
  };
  const idbOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function(name) {
    if(/breez|spark|wallet|seed|credential/i.test(String(name))) stop('wallet database open');
    return Reflect.apply(idbOpen,this,arguments);
  };
  for(const method of ['instantiate','instantiateStreaming']) {
    if(typeof WebAssembly[method] !== 'function') continue;
    const original = WebAssembly[method];
    WebAssembly[method] = function() {
      const row={method,start:performance.now()};state.wasm.push(row);
      try {return Promise.resolve(Reflect.apply(original,this,arguments)).then(value=>{
        row.end=performance.now();row.success=true;return value;
      },error=>{row.end=performance.now();row.success=false;row.errorName=error.name;throw error;});}
      catch(error){row.end=performance.now();row.success=false;row.errorName=error.name;throw error;}
    };
  }
  for(const method of ['log','info','debug','warn','error']) {
    const original=console[method];
    console[method]=function(...args){
      const line=typeof args[0]==='string'?args[0]:'';
      if(line.includes('Initializing WASM module'))mark('sdkInitRequested');
      if(line.includes('WASM module initialized successfully'))mark('sdkInitialized');
      if(line.includes('Application initialized successfully'))mark('reactRenderRequested');
      return Reflect.apply(original,this,args);
    };
  }
  try {new PerformanceObserver(list=>{
    for(const entry of list.getEntries())state.longTasks.push({start:entry.startTime,duration:entry.duration});
  }).observe({type:'longtask',buffered:true});} catch {}
  try {new PerformanceObserver(list=>{
    const entries=list.getEntries();const e=entries[entries.length-1];
    if(e)state.lcp={start:e.startTime,size:e.size,tag:e.element?.tagName||null};
  }).observe({type:'largest-contentful-paint',buffered:true});} catch {}
  const visible = element => {
    if(!element)return false;
    const r=element.getBoundingClientRect();
    if(r.width<=0||r.height<=0)return false;
    for(let n=element;n&&n.nodeType===1;n=n.parentElement){
      const s=getComputedStyle(n);
      if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0.01)return false;
    }
    return true;
  };
  let seenSplash=false,seenBrand=false;
  const poll=()=>{
    const splash=document.querySelector('#splash'),brand=document.querySelector('.gys-brand-reveal:not(.gys-brand-reveal--inline)');
    if(splash)seenSplash=true;
    if(brand){seenBrand=true;state.brandCoverSeen=true;}
    if(seenSplash&&!splash)mark('splashRemoved');
    if(seenBrand&&!visible(brand))mark('brandRevealHidden');
    const welcome=document.querySelector('.gys-welcome');
    const start=document.querySelector('.gys-welcome__start'),restore=document.querySelector('.gys-welcome__restore');
    if(welcome&&visible(start)&&visible(restore)){
      mark('onboardingDomAvailable');
      if(!visible(splash)&&!visible(brand)&&visible(welcome.querySelector('h1')))mark('onboardingReadable');
    }
    const hero=document.querySelector('.gys-welcome__hero-mark');
    if(hero?.complete&&hero.naturalWidth>0)mark('heroDecoded');
    const visualComplete=['onboardingReadable','heroDecoded','splashRemoved'].every(key=>state.marks[key]!==undefined)&&(!seenBrand||state.marks.brandRevealHidden!==undefined);
    if(performance.now()<40_000&&!state.stops.length&&!visualComplete)requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:requiredPath('GYS_CHROMIUM_PATH'),
  env:{...process.env,XDG_DATA_HOME:requiredPath('GYS_BROWSER_TRUST_HOME')},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 receipt.browserVersion=browser.version();
 try {
  for(const variant of variants){
   const {server,origin}=await serve(variant.directory);
   const context=await browser.newContext({viewport:receipt.viewport,serviceWorkers:'allow'});
   const sample={variant:variant.name,origin,startedAt:new Date().toISOString(),pageErrors:[],requestFailures:[],requests:[]};
   try {
    await context.addInitScript(instrumentation);
    context.on('request',r=>sample.requests.push({url:safeUrl(r.url()),method:r.method(),serviceWorker:!!r.serviceWorker()}));
    context.on('requestfailed',r=>sample.requestFailures.push({url:safeUrl(r.url()),error:r.failure()?.errorText||'unknown'}));
    const page=await context.newPage();page.on('pageerror',e=>sample.pageErrors.push(e.name+': '+e.message.split('\n')[0]));
    const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
    sample.html={status:response.status(),sha256:sha(await response.body())};
    await page.waitForFunction(()=>window.__gysStartupLab?.stops.length||(
     window.__gysStartupLab?.marks.splashRemoved!==undefined&&window.__gysStartupLab?.marks.onboardingDomAvailable!==undefined),{},{timeout:20000});
    sample.afterSplash=await page.evaluate(()=>{
     const brand=document.querySelector('.gys-brand-reveal:not(.gys-brand-reveal--inline)');
     return {atMs:performance.now(),marks:{...window.__gysStartupLab.marks},brandPresent:!!brand,
      brandOpacity:brand?getComputedStyle(brand).opacity:null,brandVisibility:brand?getComputedStyle(brand).visibility:null,
      startText:document.querySelector('.gys-welcome__start')?.textContent?.trim(),restorePresent:!!document.querySelector('.gys-welcome__restore')};
    });
    await page.screenshot({path:path.join(out,variant.name+'-after-splash.png'),fullPage:false});
    await page.waitForFunction(()=>window.__gysStartupLab?.stops.length||(
     window.__gysStartupLab?.marks.onboardingReadable!==undefined&&window.__gysStartupLab?.marks.heroDecoded!==undefined&&
     window.__gysStartupLab?.wasm.some(r=>r.success&&r.end!==undefined)),{},{timeout:20000});
    sample.browser=await page.evaluate(async()=>({instrumentation:window.__gysStartupLab,
     navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),
     onboarding:{heading:document.querySelector('.gys-welcome h1')?.textContent?.trim(),startText:document.querySelector('.gys-welcome__start')?.textContent?.trim(),
      restorePresent:!!document.querySelector('.gys-welcome__restore'),heroSource:document.querySelector('.gys-welcome__hero-mark')?.getAttribute('src'),
      heroNaturalWidth:document.querySelector('.gys-welcome__hero-mark')?.naturalWidth,heroNaturalHeight:document.querySelector('.gys-welcome__hero-mark')?.naturalHeight,
      heroBox:document.querySelector('.gys-welcome__hero-mark')?.getBoundingClientRect().toJSON()},
     storage:{localKeys:Object.keys(localStorage),sessionKeys:Object.keys(sessionStorage),databases:(await indexedDB.databases()).map(d=>({name:d.name,version:d.version}))},
     workerControlled:!!navigator.serviceWorker.controller
    }));
    if(sample.browser.instrumentation.stops.length)throw new Error('Read-only guard fired');
    if(sample.browser.onboarding.startText!=='Start'||!sample.browser.onboarding.restorePresent)throw new Error('Expected welcome controls missing');
    if(sample.requests.some(r=>r.method!=='GET'||!r.url.startsWith(origin+'/')))throw new Error('Unexpected non-static request');
    if(sample.pageErrors.length||sample.requestFailures.length)throw new Error('Unexpected browser error');
    if(variant.name==='before'&&!sample.browser.instrumentation.brandCoverSeen)throw new Error('Baseline brand cover was not observed');
    if(variant.name==='after'&&sample.browser.instrumentation.brandCoverSeen)throw new Error('Modified welcome still displays the cover');
    const manifest=JSON.parse(fs.readFileSync(path.join(variant.directory,'release-manifest.json'),'utf8'));
    sample.manifest={sourceRevision:manifest.sourceRevision,sourceDirty:manifest.sourceDirty,releaseId:manifest.releaseId,sdk:manifest.sdk};
   }finally{
    sample.finishedAt=new Date().toISOString();receipt.samples.push(sample);fs.writeFileSync(path.join(out,'local-visibility.json'),JSON.stringify(receipt,null,2)+'\n');
    await context.close();await new Promise(resolve=>server.close(resolve));
   }
  }
  receipt.complete=true;
 }finally{
  receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'local-visibility.json'),JSON.stringify(receipt,null,2)+'\n');await browser.close();
 }
 console.log(JSON.stringify({complete:receipt.complete,samples:receipt.samples.map(s=>({variant:s.variant,marks:s.browser.instrumentation.marks,brandSeen:s.browser.instrumentation.brandCoverSeen,afterSplash:s.afterSplash}))},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
