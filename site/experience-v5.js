/* GetYourSats product-led Experience section.
   These are previews. No wallet, signing, payment or checkout APIs are called. */
(()=>{
  'use strict';
  const shell=document.getElementById('experience-showcase');
  const panel=document.getElementById('feature-panel');
  if(!shell||!panel)return;
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const state={active:'wallet',custodyStep:0,recovery:'passkey',asset:'USDC',reverse:false,sale:4.5,item:'Coffee',merchantStage:0,frequency:'week'};
  const copy={
    wallet:{status:'YOUR KEYS. YOUR WALLET.',number:'01 — 04',title:'Your keys. Your bitcoin. Period.',detail:'Choose a supported recovery method and keep an independent backup. Your signing keys control your wallet.'},
    lightning:{status:'BITCOIN-FIRST ROUTES',number:'02 — 04',title:'Move value into Bitcoin. And back.',detail:'Explore USDC/USDT into sats and sats out to supported stablecoin destinations. Review live routes and fees inside the wallet.'},
    merchant:{status:'LIGHTNING MERCHANT POS',number:'03 — 04',title:'Checkout without the friction.',detail:'From a simple request to a confirmed Lightning receipt. See the complete counter experience in the section below.'},
    stack:{status:'FIAT DCA · COMING SOON',number:'04 — 04',title:'Small moves. A lasting habit.',detail:'Small, regular contributions, elegantly automated when recurring Bitcoin purchases launch.'}
  };

  function activate(key){
    if(!copy[key])return;
    state.active=key;
    $$('[data-ex-scene]',shell).forEach(scene=>{
      const isActive=scene.dataset.exScene===key;
      scene.hidden=!isActive;
      scene.dataset.exCurrent=String(isActive);
    });
    panel.dataset.current=key;
    $('#feature-status').textContent=copy[key].status;
    $('#feature-number').textContent=copy[key].number;
    $('#feature-name').textContent=copy[key].title;
    $('#feature-copy').textContent=copy[key].detail;
    const walletLink=$('.feature-display-footer .circle-arrow');
    if(walletLink){
      walletLink.hidden=key==='stack';
      if(key!=='stack')walletLink.setAttribute('aria-label',{
        wallet:'Open the self-custody wallet',
        lightning:'Explore Bitcoin-first routes inside the wallet',
        merchant:'Open the merchant POS inside the wallet'
      }[key]);
    }
    if(key==='merchant')showMerchantStage(reduced.matches?2:0);
    if(key==='stack')showStackCycle(reduced.matches?3:0);
    updateBeatLoop();updateStackLoop();
  }
  // One source of truth for feature tabs and their accessible keyboard flow.
  const featureTabs=$$('.feature-tab');
  function selectFeature(button,focus=false){
    featureTabs.forEach(t=>{const yes=t===button;
      t.classList.toggle('selected',yes);
      t.setAttribute('aria-selected',String(yes));
      t.tabIndex=yes?0:-1;
    });
    panel.setAttribute('aria-labelledby',button.id);
    activate(button.dataset.feature);
    if(focus)button.focus();
  }
  featureTabs.forEach((b,index)=>{
    b.addEventListener('click',()=>selectFeature(b));
    b.addEventListener('keydown',e=>{
      if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
      e.preventDefault();
      const n=e.key==='Home'?0:e.key==='End'?featureTabs.length-1:
        (index+(['ArrowDown','ArrowRight'].includes(e.key)?1:-1)+featureTabs.length)%featureTabs.length;
      selectFeature(featureTabs[n],true);
    });
  });

  /* 01 / self-custody walkthrough */
  const custodyStages={
    passkey:[
      {eye:'YOUR WALLET · YOUR RECOVERY',title:'Choose how you want to secure it.',detail:'Your wallet gives you control of your keys. Pick a supported recovery method to continue.',caption:'Your keys are never displayed in this preview.',next:'Continue →'},
      {eye:'SECURE YOUR ACCESS',title:'Approve on your device.',detail:'A supported passkey uses your device’s security controls. Check how you would regain access on another device.',caption:'Actual biometric or passkey approval happens only in the wallet.',next:'Review recovery →'},
      {eye:'READY TO BEGIN',title:'You’re in control.',detail:'With your recovery method understood, begin with a small incoming payment and build confidence from there.',caption:'No wallet has been created by this walkthrough.',next:'Start again ↻'}
    ],
    manual:[
      {eye:'YOUR WALLET · YOUR RECOVERY',title:'Choose how you want to secure it.',detail:'Your wallet gives you control of your keys. Pick a supported recovery method to continue.',caption:'Your keys are never displayed in this preview.',next:'Continue →'},
      {eye:'OFFLINE RECOVERY',title:'Keep recovery words private.',detail:'Store your recovery phrase offline. Never screenshot it, upload it or share it with anyone, including support.',caption:'Actual recovery words are only shown during legitimate wallet setup.',next:'Review recovery →'},
      {eye:'READY TO BEGIN',title:'You’re in control.',detail:'Check that your offline backup is safe and recoverable before you start receiving meaningful funds.',caption:'No wallet has been created by this walkthrough.',next:'Start again ↻'}
    ]
  };
  function renderCustody(){
    const stage=custodyStages[state.recovery][state.custodyStep];
    $('#ex-custody-eyebrow').textContent=stage.eye;
    $('#ex-custody-title').textContent=stage.title;
    $('#ex-custody-copy').textContent=stage.detail;
    $('#ex-custody-caption').textContent=stage.caption;
    $('#ex-custody-next').textContent=stage.next;
    $('#ex-custody-methods').hidden=state.custodyStep!==0;
    $('#ex-custody-badge').hidden=state.custodyStep!==2;
    $('#ex-custody-reset').hidden=state.custodyStep===0;
    $$('[data-ex-cstep]').forEach(dot=>{
      const i=Number(dot.dataset.exCstep);
      dot.classList.toggle('active',i===state.custodyStep);
      dot.classList.toggle('done',i<state.custodyStep);
      dot.textContent=i<state.custodyStep?'✓':String(i+1);
    });
    $$('[data-ex-recovery]').forEach(btn=>{
      const selected=btn.dataset.exRecovery===state.recovery;
      btn.setAttribute('aria-pressed',String(selected));btn.classList.toggle('is-selected',selected);
    });
  }
  $$('[data-ex-recovery]').forEach(btn=>btn.addEventListener('click',()=>{
    state.recovery=btn.dataset.exRecovery;
    renderCustody();
  }));
  $('#ex-custody-next').addEventListener('click',()=>{
    state.custodyStep=state.custodyStep===2?0:state.custodyStep+1;
    renderCustody();
  });
  $('#ex-custody-reset').addEventListener('click',()=>{state.custodyStep=0;renderCustody()});

  /* Simple product-language network showcase.
     The real SDK discovers route availability at runtime by asset, direction,
     destination and provider. The website never makes a firm route promise. */
  function renderRoute(){
    const from=state.reverse?'sats':state.asset;
    const to=state.reverse?state.asset:'sats';
    $('#ex-source-caption').textContent=from;
    $('#ex-target-caption').textContent=to;
    $('#ex-source-sub').textContent=from==='sats'?'Your wallet':'Supported network';
    $('#ex-target-sub').textContent=to==='sats'?'Your wallet':'Supported destination';
    $('#ex-source-icon').textContent=from==='sats'?'₿':from==='USDT'?'₮':'$';
    $('#ex-target-icon').textContent=to==='sats'?'₿':to==='USDT'?'₮':'$';
    $('#ex-source-icon').className='ex-node-round '+(from==='sats'?'ex-node-round--btc':from==='USDT'?'ex-node-round--usdt':'ex-node-round--token');
    $('#ex-target-icon').className='ex-node-round '+(to==='sats'?'ex-node-round--btc':to==='USDT'?'ex-node-round--usdt':'ex-node-round--token');
    const track=$('#ex-route-track');
    track.classList.remove('is-reversed');
    track.dataset.direction=state.reverse?'sats-out':'stable-in';
    $('#ex-arc-label').textContent=state.reverse?'SEND BTC VALUE':'RECEIVE AS SATS';
    $('#ex-route-context').textContent=state.reverse?'SEND FROM YOUR SATS BALANCE':'RECEIVE INTO YOUR SATS BALANCE';
    $('#ex-route-pair').textContent=from.toUpperCase()+'  →  '+to.toUpperCase();
    $('#ex-route-stage').dataset.direction=state.reverse?'outbound':'inbound';
    $('#ex-route-source-label').textContent=from==='sats'?'YOUR BITCOIN':'SUPPORTED STABLECOIN';
    $('#ex-route-target-label').textContent=to==='sats'?'YOUR BITCOIN':'SUPPORTED STABLECOIN';
    $('#ex-route-description').textContent=state.reverse
      ? 'Send sats as '+state.asset+' on supported networks'
      : 'Receive '+state.asset+' value as sats';
    $$('[data-ex-asset]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.exAsset===state.asset)));
  }
  $$('[data-ex-asset]').forEach(btn=>btn.addEventListener('click',()=>{
    state.asset=btn.dataset.exAsset;
    renderRoute();
  }));
  $('#ex-route-reverse').addEventListener('click',()=>{
    state.reverse=!state.reverse;
    renderRoute();
  });
  renderRoute();

  /* 03 / cinematic merchant journey: narrative, not a second POS interface.
     The real interactive counter remains in section 04. No invoices are created. */
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const beatFrames=[
    {status:'01 / INVOICE', ticket:'Lightning request prepared',wallet:'Ready to receive.',caption:'The wallet prepares an invoice for a sale.'},
    {status:'02 / LIGHTNING',ticket:'Customer scans and pays',wallet:'A payment is moving.',caption:'The Lightning network routes the payment.'},
    {status:'03 / VERIFIED',ticket:'Payment status checked',wallet:'Confirmed. Sats received.',caption:'The wallet verifies settlement, then confirms.'}
  ];
  let beatTimer=null,beatPaused=false,filmBeat=0;
  function showMerchantStage(beat){
    filmBeat=Math.max(0,Math.min(2,beat));const f=beatFrames[filmBeat];
    const film=$('#ex-merchant-film'); film.dataset.beat=String(filmBeat);
    $('#ex-film-state').textContent=f.status;
    $('#ex-film-ticket-text').textContent=f.ticket;
    $('#ex-film-wallet-heading').textContent=f.wallet;
    $('#ex-film-wallet-caption').textContent=f.caption;
    $$('[data-ex-film-beat]').forEach(btn=>btn.setAttribute('aria-pressed',String(Number(btn.dataset.exFilmBeat)===filmBeat)));
  }
  function advanceBeat(){showMerchantStage((filmBeat+1)%3)}
  function stopBeatLoop(){if(beatTimer!==null){clearInterval(beatTimer);beatTimer=null}}
  function updateBeatLoop(){stopBeatLoop();if(state.active==='merchant'&&!beatPaused&&!reduced.matches&&!document.hidden)
    beatTimer=window.setInterval(advanceBeat,3600)}
  $$('[data-ex-film-beat]').forEach(b=>b.addEventListener('click',()=>{showMerchantStage(Number(b.dataset.exFilmBeat));updateBeatLoop()}));
  $('#ex-film-replay').addEventListener('click',()=>{beatPaused=false;showMerchantStage(0);updateBeatLoop()});

  /* 04 / speculative DCA: four purchases roll across an illustrated ledger.
     No price prediction, quote, signing or purchase API. */
  let stackCycle=0,stackTimer=null,stackPaused=false;
  function showStackCycle(step){
    stackCycle=step;const n=step+1;const monthly=state.frequency==='month';
    $('#ex-stack-film').dataset.cycle=String(step);
    $('#ex-stack-total').textContent='$'+(n*25).toLocaleString('en-US');
    $('#ex-stack-period').textContent=monthly?'every month':'every week';
    $$('[data-ex-roll]').forEach((row,i)=>{
      const type=i===step?'active':i<step?'complete':'upcoming';
      row.dataset.stage=type;
      const label=$('#ex-stack-row-'+i);
      if(label) label.textContent=(monthly?'Month ':'Week ')+String(i+1).padStart(2,'0');
    });
    $$('[data-ex-frequency]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.exFrequency===state.frequency)));
  }
  function stopStackLoop(){if(stackTimer!==null){clearInterval(stackTimer);stackTimer=null}}
  function updateStackLoop(){stopStackLoop();if(state.active==='stack'&&!stackPaused&&!reduced.matches&&!document.hidden)
    stackTimer=window.setInterval(()=>showStackCycle((stackCycle+1)%4),2400)}
  function setStackPause(value){stackPaused=value;const b=$('#ex-stack-pause');b.setAttribute('aria-pressed',String(value));b.textContent=value?'Play':'Pause';updateStackLoop()}
  $('#ex-stack-replay').addEventListener('click',()=>{stackPaused=false;showStackCycle(0);setStackPause(false)});
  $('#ex-stack-pause').addEventListener('click',()=>setStackPause(!stackPaused));
  $$('[data-ex-frequency]').forEach(btn=>btn.addEventListener('click',()=>{state.frequency=btn.dataset.exFrequency;showStackCycle(0);updateStackLoop()}));
  document.addEventListener('visibilitychange',()=>{updateBeatLoop();updateStackLoop()});
  reduced.addEventListener?.('change',()=>{if(reduced.matches){showMerchantStage(2);showStackCycle(3)}updateBeatLoop();updateStackLoop()});

  renderCustody();renderRoute();showMerchantStage(reduced.matches?2:0);showStackCycle(reduced.matches?3:0);selectFeature(featureTabs[0]);
})();


/* Hero: a restrained continuous storyboard of stablecoin -> sats receipts.
   Amounts are illustrative, not read from an SDK or a live fiat quote. */
(()=>{'use strict';
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const $=q=>document.querySelector(q);
 const home=$('#screen-content');
 if(!home||!window.gysHeroPreview)return;
 const examples=[{token:'USDC',symbol:'$',value:4200},{token:'USDT',symbol:'₮',value:3600},{token:'USDC',symbol:'$',value:2900}];
 let index=0,total=0,timer=null,raf=null,visible=true;
 const number=new Intl.NumberFormat('en-US');
 function showExample(){
   if(!home.querySelector('#hero-sats-story'))return;
   const item=examples[index];const story=$('#hero-sats-story');
   const coin=$('#hero-source-coin');coin.dataset.token=item.token;
   $('#hero-source-symbol').textContent=item.symbol;$('#hero-source-name').textContent=item.token;
   $('#hero-sats-credit-label').textContent='ILLUSTRATIVE '+item.token+' → SATS';
   const start=total,finish=total+item.value; total=finish;
   story.dataset.phase='routing';
   const label=$('#hero-sats-credit-number'); label.textContent='+ '+number.format(item.value)+' sats';
   if(raf)cancelAnimationFrame(raf);
   if(reduced.matches){window.gysHeroPreview.setAmount(finish);story.dataset.phase='credited';return}
   const began=performance.now();
   const tick=now=>{
      const t=Math.min(1,(now-began)/1550),ease=1-Math.pow(1-t,3);
      window.gysHeroPreview.setAmount(Math.round(start+(finish-start)*ease));
      if(t<1)raf=requestAnimationFrame(tick);
      else {story.dataset.phase='credited';raf=null}
   };
   raf=requestAnimationFrame(tick);
 }
 function advance(){index=(index+1)%examples.length;if(index===0)total=0;showExample()}
 function canRun(){return visible&&!document.hidden&&!reduced.matches&&!!$('#hero-sats-story')}
 function refresh(){if(timer!==null){clearInterval(timer);timer=null}if(canRun())timer=setInterval(advance,5100)}
 const io='IntersectionObserver' in window?new IntersectionObserver(e=>{visible=e.some(x=>x.isIntersecting);refresh()},{threshold:.12}):null;
 io?.observe($('#wallet-device'));
 document.addEventListener('visibilitychange',refresh);reduced.addEventListener?.('change',()=>{if(reduced.matches){if(timer)clearInterval(timer);timer=null;index=0;total=0;showExample()}else refresh()});
 $('#wallet-device').addEventListener('click',e=>{
   if(e.target.closest('[data-screen]')){
     if(e.target.closest('[data-screen]').dataset.screen==='activity'){
       total=0;index=0;setTimeout(()=>{showExample();refresh()},80)
     }else refresh();
   }
 });
 showExample();refresh();
})();
