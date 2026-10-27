const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Publication copy: only runtime/output paths differ from the executed harness.
const requiredPath = name => { const value = process.env[name]; if (!value) throw new Error(name + ' is required'); return path.resolve(value); };
const {chromium} = require(requiredPath('GYS_PLAYWRIGHT_MODULE'));
const chromiumExecutable = requiredPath('GYS_CHROMIUM_PATH');
const browserTrustHome = requiredPath('GYS_BROWSER_TRUST_HOME');

const out = requiredPath('GYS_STARTUP_LAB_OUTPUT');
fs.mkdirSync(out, {recursive:true});
const origin = 'https://wallet.getyoursats.com';
const expectedSource = '07ddf16068cc5bd7ed09397e221800ad7b12d767';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safeUrl = value => { try {const u = new URL(value); return u.origin + u.pathname;} catch {return '[non-URL]';} };
const receipt = {
  schema:1, startedAt:new Date().toISOString(), origin, expectedSource,
  scope:'Public onboarding startup lab, disposable Chromium state, no wallet interaction',
  normalTls:true, viewport:{width:390,height:844}, samples:[],
  conditions:[
    {name:'unthrottled-1',cpuRate:1,network:null},
    {name:'constrained-lab',cpuRate:4,network:{latencyMs:150,downloadMbps:10,uploadMbps:2}},
  ],
  limits:{physicalDevice:false,fieldPerformance:false,walletReadyMeasured:false,
    explanation:'Onboarding readability and SDK instantiation are distinct from a connected wallet. No Start/Restore click, wallet connection, credential ceremony, funded operation or email. CDP throttling is a page-target lab simulation.'},
};

function instrumentation() {
  const state = window.__gysStartupLab = {timeOrigin:performance.timeOrigin,marks:{},longTasks:[],stops:[],wasm:[]};
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
    if(brand)seenBrand=true;
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
    const visualComplete=['onboardingReadable','heroDecoded','splashRemoved','brandRevealHidden'].every(key=>state.marks[key]!==undefined);
    if(performance.now()<40_000&&!state.stops.length&&!visualComplete)requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

async function collect(context,page,cdp,condition,temperature) {
  const sample={condition:condition.name,temperature,startedAt:new Date().toISOString(),network:[],pageErrors:[],requestFailures:[]};
  const pending=[];const cdpRows=new Map();
  const requests = new Map();
  const onRequest=request=>requests.set(request,{url:safeUrl(request.url()),method:request.method(),resourceType:request.resourceType(),serviceWorker:!!request.serviceWorker()});
  const onFinished=request=>{
    const row=requests.get(request)||{url:safeUrl(request.url()),method:request.method(),resourceType:request.resourceType(),serviceWorker:!!request.serviceWorker()};
    pending.push((async()=>{
      const response=await request.response();
      if(!response)return;
      row.status=response.status();row.timing=request.timing();
      row.fromServiceWorker=response.fromServiceWorker();
      try {row.sizes=await request.sizes();} catch {}
      const headers=await response.allHeaders();
      row.headers=Object.fromEntries(Object.entries(headers).filter(([key])=>['content-type','content-encoding','content-length','cache-control','age','x-vercel-cache'].includes(key)));
      if(/breez.*\.wasm$/.test(row.url)&&temperature==='cold'){
        try {const bytes=await response.body();row.decodedBytes=bytes.length;row.sha256=hash(bytes);}catch(error){row.bodyReadError=error.name;}
      }
      sample.network.push(row);
    })());
  };
  const onFailed=request=>sample.requestFailures.push({url:safeUrl(request.url()),error:request.failure()?.errorText||'unknown'});
  const onError=error=>sample.pageErrors.push(error.name+': '+error.message.split('\n')[0].replace(/https?:\/\/[^\s]+/g,'[URL]'));
  const onCDPRequest=e=>cdpRows.set(e.requestId,{url:safeUrl(e.request.url),method:e.request.method,type:e.type,
    requestTime:e.timestamp,initiator:{type:e.initiator.type,stack:(e.initiator.stack?.callFrames||[]).slice(0,4).map(f=>({url:safeUrl(f.url),line:f.lineNumber,column:f.columnNumber}))}});
  const onCDPResponse=e=>{
    const row=cdpRows.get(e.requestId);if(!row)return;
    row.responseTime=e.timestamp;row.status=e.response.status;row.protocol=e.response.protocol;
    row.fromDiskCache=!!e.response.fromDiskCache;row.fromServiceWorker=!!e.response.fromServiceWorker;row.responseTiming=e.response.timing;
  };
  const onCDPFinished=e=>{const row=cdpRows.get(e.requestId);if(row){row.finishedTime=e.timestamp;row.encodedDataLength=e.encodedDataLength;}};
  context.on('request',onRequest);context.on('requestfinished',onFinished);context.on('requestfailed',onFailed);page.on('pageerror',onError);
  cdp.on('Network.requestWillBeSent',onCDPRequest);cdp.on('Network.responseReceived',onCDPResponse);cdp.on('Network.loadingFinished',onCDPFinished);
  console.log(JSON.stringify({phase:'navigate',condition:condition.name,temperature}));
  try {
    const navigation=temperature==='cold'?await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000}):await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    sample.html={status:navigation.status(),sha256:hash(await navigation.body())};
    await page.waitForFunction(()=>window.__gysStartupLab?.stops.length||(
      window.__gysStartupLab?.marks.onboardingReadable!==undefined&&window.__gysStartupLab?.wasm.some(row=>row.success&&row.end!==undefined)),{},{timeout:40000});
    const stopped=await page.evaluate(()=>window.__gysStartupLab.stops);
    if(stopped.length)throw new Error('Read-only guard triggered: '+stopped.map(x=>x.reason).join(', '));
    await page.waitForTimeout(1200);
    sample.browser=await page.evaluate(async()=>({
      instrumentation:window.__gysStartupLab,
      navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),
      paint:performance.getEntriesByType('paint').map(e=>e.toJSON()),
      resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),
      onboarding:{startText:document.querySelector('.gys-welcome__start')?.textContent?.trim(),
        restorePresent:!!document.querySelector('.gys-welcome__restore'),heading:document.querySelector('.gys-welcome h1')?.textContent?.trim()},
      storage:{localKeys:Object.keys(localStorage).sort(),sessionKeys:Object.keys(sessionStorage).sort(),databases:(await indexedDB.databases()).map(d=>({name:d.name,version:d.version}))},
      serviceWorker:{controlled:!!navigator.serviceWorker.controller,
        registrations:await navigator.serviceWorker.getRegistrations().then(rs=>rs.map(r=>({active:r.active?.state,waiting:r.waiting?.state,installing:r.installing?.state})))},
      userAgent:navigator.userAgent,devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,
    }));
    if(sample.browser.onboarding.startText!=='Start'||!sample.browser.onboarding.restorePresent)throw new Error('Expected no-wallet onboarding is absent');
    sample.browser.resources=sample.browser.resources.map(r=>({...r,name:safeUrl(r.name)}));
    sample.browser.navigation=sample.browser.navigation.map(r=>({...r,name:safeUrl(r.name)}));
    await Promise.allSettled(pending);
    sample.cdpNetwork=Array.from(cdpRows.values());
    if(condition.name==='unthrottled-1'&&temperature==='cold')await page.screenshot({path:path.join(out,'onboarding-readable.png'),fullPage:false});
  } finally {
    context.off('request',onRequest);context.off('requestfinished',onFinished);context.off('requestfailed',onFailed);page.off('pageerror',onError);
    cdp.off('Network.requestWillBeSent',onCDPRequest);cdp.off('Network.responseReceived',onCDPResponse);cdp.off('Network.loadingFinished',onCDPFinished);
    sample.finishedAt=new Date().toISOString();receipt.samples.push(sample);
    fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(receipt,null,2)+'\n');
  }
  console.log(JSON.stringify({phase:'measured',condition:condition.name,temperature,marks:sample.browser.instrumentation.marks,requests:sample.network.length}));
  return sample;
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable,
    env:{...process.env,XDG_DATA_HOME:browserTrustHome},
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  receipt.browserVersion=browser.version();
  try {
    for(const condition of receipt.conditions){
      const context=await browser.newContext({viewport:receipt.viewport,serviceWorkers:'allow'});
      try {
        await context.addInitScript(instrumentation);
        const page=await context.newPage();const cdp=await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:condition.cpuRate});
        if(condition.network)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:condition.network.latencyMs,
          downloadThroughput:condition.network.downloadMbps*1_000_000/8,uploadThroughput:condition.network.uploadMbps*1_000_000/8,connectionType:'cellular4g'});
        const cold=await collect(context,page,cdp,condition,'cold');
        if(!receipt.manifest){
          const manifest=await page.evaluate(async()=>{const r=await fetch('/release-manifest.json',{cache:'no-store'});if(!r.ok)throw new Error('Public release manifest unavailable');return r.json();});
          receipt.observedManifestIdentity={sourceRevision:manifest.sourceRevision,releaseId:manifest.releaseId,sourceDirty:manifest.sourceDirty,sdk:manifest.sdk,observedAt:new Date().toISOString()};
          if(manifest.sourceRevision!==expectedSource||manifest.sourceDirty!==false)throw new Error('Public source differs from expected corrective artifact');
          const html=manifest.artifacts.find(a=>a.path==='index.html');
          if(html.sha256!==cold.html.sha256)throw new Error('Public HTML differs from manifest');
          const wasm=manifest.artifacts.find(a=>/breez.*\.wasm$/.test(a.path));
          const measured=cold.network.find(a=>a.sha256&&a.url.endsWith('/'+wasm.path));
          if(!measured||measured.sha256!==wasm.sha256||measured.decodedBytes!==wasm.bytes)throw new Error('Measured SDK WASM differs from release manifest');
          receipt.manifest={sourceRevision:manifest.sourceRevision,releaseId:manifest.releaseId,sourceDirty:manifest.sourceDirty,sdk:manifest.sdk,
            relevantArtifacts:manifest.artifacts.filter(a=>a.path==='index.html'||a.path==='sw.js'||a.path==='brand/wordmark-3d-transparent.png'||/^assets\/.*\.(js|wasm|css)$/.test(a.path))};
        }
        await page.evaluate(()=>Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(resolve,5000))]).then(()=>undefined));
        await collect(context,page,cdp,condition,'warm');
      }finally{await context.close();}
    }
    receipt.complete=true;
  }catch(error){receipt.complete=false;receipt.error=error.name+': '+error.message.split('Call log:')[0];process.exitCode=1;}
  finally{
    receipt.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(receipt,null,2)+'\n');
    await browser.close();
  }
  console.log(JSON.stringify({complete:receipt.complete,samples:receipt.samples.length,error:receipt.error||null,receipt:path.join(out,'measurement.json')}));
})();
