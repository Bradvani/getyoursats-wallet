const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const requiredPath=name=>{const value=process.env[name];if(!value)throw new Error(name+' is required');return path.resolve(value);};
const {chromium}=require(requiredPath('GYS_PLAYWRIGHT_MODULE'));
const out=requiredPath('GYS_A13_OUTPUT');
const directory=requiredPath('GYS_A13_AFTER_DIST');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const safeUrl=value=>{const u=new URL(value);return u.origin+u.pathname;};
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8',
 '.json':'application/json','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png',
 '.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
const receipt={schemaVersion:1,title:'A13 candidate settled visual follow-up',startedAt:new Date().toISOString(),
 sourceCommit:'942d20a85cebb2d92b1bf174f9265cd4fb5b00dd',sourceTree:'b18c72ef8622d06de4e38fcc3c9662b3e915f664',
 viewport:{width:390,height:844},scope:'One read-only local page load of the existing after build. No source edits, wallet actions or performance acceptance.',
 originalScreenshot:{file:'after-readable.png',sha256:sha(fs.readFileSync(path.join(out,'after-readable.png')))},
 requests:[],pageErrors:[],requestFailures:[],assetResponses:[]};
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
}function instrumentation() {
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
  const effectiveOpacity = element => {
    if(!visible(element))return 0;
    let opacity=1;
    for(let n=element;n&&n.nodeType===1;n=n.parentElement)opacity*=Number(getComputedStyle(n).opacity);
    return opacity;
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
      if(!visible(splash)&&!visible(brand)&&visible(welcome.querySelector('h1'))){
        mark('onboardingUnoccluded');
        if(['h1','.gys-welcome__subtitle','.gys-welcome__start','.gys-welcome__restore','.gys-welcome__hero-mark'].every(selector=>effectiveOpacity(welcome.querySelector(selector))>=0.95))mark('onboardingLegible');
      }
    }
    const hero=document.querySelector('.gys-welcome__hero-mark');
    if(hero?.complete&&hero.naturalWidth>0)mark('heroDecoded');
    const visualComplete=['onboardingLegible','heroDecoded','splashRemoved'].every(key=>state.marks[key]!==undefined)&&(!seenBrand||state.marks.brandRevealHidden!==undefined);
    if(performance.now()<40_000&&!state.stops.length&&!visualComplete)requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

(async()=>{
 const {server,origin}=await serve(directory);receipt.origin=origin;
 const browser=await chromium.launch({headless:true,executablePath:requiredPath('GYS_CHROMIUM_PATH'),
  env:{...process.env,XDG_DATA_HOME:requiredPath('GYS_BROWSER_TRUST_HOME')},args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:receipt.viewport,serviceWorkers:'allow'});receipt.browserVersion=browser.version();
 const pending=[];
 try{
  await context.addInitScript(instrumentation);
  context.on('request',r=>receipt.requests.push({url:safeUrl(r.url()),method:r.method(),serviceWorker:!!r.serviceWorker()}));
  context.on('requestfailed',r=>receipt.requestFailures.push({url:safeUrl(r.url()),error:r.failure()?.errorText||'unknown'}));
  context.on('response',r=>{
   if(new URL(r.url()).pathname==='/brand/wordmark-3d-transparent.png')pending.push((async()=>{
    const bytes=await r.body();receipt.assetResponses.push({url:safeUrl(r.url()),status:r.status(),contentType:r.headers()['content-type'],bytes:bytes.length,sha256:sha(bytes),fromServiceWorker:r.fromServiceWorker()});
   })());
  });
  const page=await context.newPage();page.on('pageerror',e=>receipt.pageErrors.push(e.name+': '+e.message.split('\n')[0]));
  const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});receipt.html={status:response.status(),sha256:sha(await response.body())};
  await page.waitForFunction(()=>window.__gysStartupLab?.stops.length||(
   window.__gysStartupLab?.marks.onboardingLegible!==undefined&&document.querySelector('.gys-welcome__header')&&document.querySelector('[aria-label="Language"]')),{},{timeout:20000});
  receipt.completion=await page.evaluate(async()=>{
   if(window.__gysStartupLab.stops.length)throw new Error('Read-only guard fired');
   const image=document.querySelector('.gys-welcome__hero-mark');await image.decode();
   await document.fonts.ready;
   const animations=document.getAnimations().filter(a=>{
    const target=a.effect?.target;
    return target instanceof Element&&!!target.closest('.gys-welcome')&&Number.isFinite(Number(a.effect.getComputedTiming().endTime));
   });
   const before=animations.map(a=>({name:a.animationName||a.constructor.name,playState:a.playState,target:a.effect.target.className,duration:a.effect.getComputedTiming().duration,endTime:a.effect.getComputedTiming().endTime}));
   await Promise.all(animations.map(a=>a.finished));
   const frameTimes=[];
   await new Promise(resolve=>requestAnimationFrame(t=>{frameTimes.push(t);requestAnimationFrame(t2=>{frameTimes.push(t2);resolve();});}));
   return {atMs:performance.now(),imageDecoded:true,fontsStatus:document.fonts.status,finiteAnimations:before,finiteAnimationsCompleted:animations.every(a=>a.playState==='finished'),animationFrameTimes:frameTimes};
  });
  receipt.display=await page.evaluate(()=>{
   const selectors={header:'.gys-welcome__header',scarcity:'.gys-welcome__scarcity-pill',language:'[aria-label="Language"]',hero:'.gys-welcome__hero-mark',heading:'.gys-welcome h1',subtitle:'.gys-welcome__subtitle',start:'.gys-welcome__start',restore:'.gys-welcome__restore'};
   const rows={};
   for(const[name,selector]of Object.entries(selectors)){
    const el=document.querySelector(selector);if(!el){rows[name]={present:false};continue;}
    const ancestors=[];let opacity=1,visible=true;
    for(let a=el;a&&a.nodeType===1;a=a.parentElement){const s=getComputedStyle(a),rect=a.getBoundingClientRect();opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)visible=false;
     ancestors.push({tag:a.tagName,className:a.className,opacity:s.opacity,display:s.display,visibility:s.visibility,overflowX:s.overflowX,overflowY:s.overflowY,transform:s.transform,zIndex:s.zIndex,rect:rect.toJSON()});}
    const rect=el.getBoundingClientRect(),style=getComputedStyle(el),center=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    rows[name]={present:true,visible:visible&&rect.width>0&&rect.height>0,combinedOpacity:opacity,rect:rect.toJSON(),inViewport:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
     cssContent:style.content,fontFamily:style.fontFamily,centerHit:center?{tag:center.tagName,className:center.className}:null,ancestors};
    if(el instanceof HTMLImageElement)rows[name].image={src:el.getAttribute('src'),currentSrc:el.currentSrc,complete:el.complete,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight};
    if(el instanceof HTMLSelectElement)rows[name].selectedText=el.selectedOptions[0]?.textContent;
   }
   return {atMs:performance.now(),elements:rows,splashPresent:!!document.querySelector('#splash'),fullScreenBrandPresent:!!document.querySelector('.gys-brand-reveal:not(.gys-brand-reveal--inline)'),
    safetyStops:window.__gysStartupLab.stops,brandCoverEverSeen:window.__gysStartupLab.brandCoverSeen};
  });
  for(const[name,row]of Object.entries(receipt.display.elements))if(!row.present||!row.visible||row.combinedOpacity<0.999||!row.inViewport)throw new Error('Unsettled or clipped required element: '+name);
  if(receipt.display.splashPresent||receipt.display.fullScreenBrandPresent||receipt.display.safetyStops.length)throw new Error('Unexpected overlay or safety stop');
  const cdp=await context.newCDPSession(page);
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  const bytes=Buffer.from(screenshot.data,'base64');fs.writeFileSync(path.join(out,'after-settled-verified.png'),bytes);
  receipt.screenshot={file:'after-settled-verified.png',bytes:bytes.length,sha256:sha(bytes),method:'CDP Page.captureScreenshot fromSurface:true after normal finite animation completion and two requestAnimationFrame callbacks'};
  receipt.storage=await page.evaluate(async()=>({localKeys:Object.keys(localStorage),sessionKeys:Object.keys(sessionStorage),databases:(await indexedDB.databases()).map(d=>({name:d.name,version:d.version}))}));
  await Promise.all(pending);
  if(!receipt.assetResponses.length||receipt.assetResponses.some(r=>r.status!==200||r.sha256!=='7b174cca6593622dd8112a7cfe6cb199bd087d5c33617b0402ab80e7901e5bf1'||r.bytes!==1123109))throw new Error('Unexpected hero response');
  if(receipt.pageErrors.length||receipt.requestFailures.length||receipt.requests.some(r=>r.method!=='GET'||!r.url.startsWith(origin+'/')))throw new Error('Unexpected browser errors or traffic');
  receipt.complete=true;
 }finally{
  receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'settled-visual-proof.json'),JSON.stringify(receipt,null,2)+'\n');
  await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));
 }
 console.log(JSON.stringify({complete:receipt.complete,screenshot:receipt.screenshot,completion:receipt.completion,elements:Object.fromEntries(Object.entries(receipt.display.elements).map(([name,r])=>[name,{visible:r.visible,opacity:r.combinedOpacity,inViewport:r.inViewport,image:r.image}])),assetResponses:receipt.assetResponses},null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
