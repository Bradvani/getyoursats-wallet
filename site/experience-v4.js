/* GetYourSats product-led Experience section.
   These are previews. No wallet, signing, payment or checkout APIs are called. */
(()=>{
  'use strict';
  const shell=document.getElementById('experience-showcase');
  const panel=document.getElementById('feature-panel');
  if(!shell||!panel)return;
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const state={active:'wallet',custodyStep:0,recovery:'passkey',asset:'USDC',reverse:false,routeReviewed:false,sale:4.5,item:'Coffee',merchantStage:0,frequency:'week'};
  const copy={
    wallet:{status:'100% SELF-CUSTODY',number:'01 — 04',title:'Your keys. Your bitcoin. Period.',detail:'Choose how to secure your wallet. Your signing keys stay under your control, and your recovery choices remain yours.'},
    lightning:{status:'BITCOIN-FIRST ROUTES',number:'02 — 04',title:'Move value into Bitcoin. And back.',detail:'Explore USDC/USDT into sats and sats out to supported stablecoin destinations. Review live routes and fees inside the wallet.'},
    merchant:{status:'LIGHTNING MERCHANT POS',number:'03 — 04',title:'Checkout without the friction.',detail:'Create a charge, show a Lightning invoice and verify the payment in your wallet. The walkthrough is illustrative.'},
    stack:{status:'FIAT DCA · COMING SOON',number:'04 — 04',title:'Small moves. A lasting habit.',detail:'Explore how recurring weekly or monthly contributions could work. Fiat DCA remains a coming-soon feature.'}
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
    if(key==='merchant')showMerchantStage(0);
  }
  $$('.feature-tab').forEach(button=>button.addEventListener('click',()=>activate(button.dataset.feature)));
  // The original page already handles roving tab focus and aria-selected.
  $$('.feature-tab').forEach(button=>button.addEventListener('keydown',e=>{
    if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;
    requestAnimationFrame(()=>activate(document.activeElement?.dataset?.feature||state.active));
  }));

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

  /* 02 / stablecoin ↔ sats route explorer, intentionally without fictitious quotes */
  function renderRoute(){
    const [from,to]=state.reverse?['sats',state.asset]:[state.asset,'sats'];
    $('#ex-source-caption').textContent=from;
    $('#ex-source-sub').textContent=from==='sats'?'Your wallet':'Supported chain';
    $('#ex-target-caption').textContent=to;
    $('#ex-target-sub').textContent=to==='sats'?'Your wallet':'Supported destination';
    $('#ex-source-icon').textContent=from==='sats'?'₿':'$';
    $('#ex-target-icon').textContent=to==='sats'?'₿':'$';
    $('#ex-source-icon').className='ex-node-round '+(from==='sats'?'ex-node-round--btc':'ex-node-round--token');
    $('#ex-target-icon').className='ex-node-round '+(to==='sats'?'ex-node-round--btc':'ex-node-round--token');
    $('#ex-route-track').classList.toggle('is-reversed',state.reverse);
    $('#ex-arc-label').textContent=state.reverse?'BITCOIN TO STABLE':'STABLE TO BITCOIN';
    $$('[data-ex-asset]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.exAsset===state.asset)));
    $('#ex-route-preview').textContent=state.routeReviewed?'Reset preview ↻':'See the route →';
    const note=$('#ex-route-note');note.classList.toggle('is-reviewed',state.routeReviewed);
    note.lastElementChild.textContent=state.routeReviewed
      ? `${from} → ${to}. In the wallet you can select the supported network, inspect a provider quote and fees, and confirm the route before sending. No swap was performed here.`
      :`Choose ${state.asset}, then reverse the direction to explore ${state.reverse?'sending sats to a supported stablecoin destination':'receiving stablecoins as sats'}.`;
  }
  $$('[data-ex-asset]').forEach(btn=>btn.addEventListener('click',()=>{state.asset=btn.dataset.exAsset;state.routeReviewed=false;renderRoute()}));
  $('#ex-route-reverse').addEventListener('click',()=>{state.reverse=!state.reverse;state.routeReviewed=false;renderRoute()});
  $('#ex-route-preview').addEventListener('click',()=>{state.routeReviewed=!state.routeReviewed;renderRoute()});

  /* 03 / merchant checkout: stage changes are explicitly illustrative */
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
  function showMerchantStage(stage){
    state.merchantStage=stage;
    ['ex-merchant-sale','ex-merchant-qr-view','ex-merchant-success'].forEach((id,i)=>$('#'+id).hidden=i!==stage);
    $('#ex-merchant-total').textContent=money(state.sale);
    $('#ex-merchant-preview-total').textContent=money(state.sale)+' · '+state.item;
    $('#ex-merchant-receipt-text').textContent=money(state.sale)+' · '+state.item;
    $$('[data-ex-sale]').forEach(btn=>{
      const selected=Number(btn.dataset.exSale)===state.sale;
      btn.classList.toggle('is-selected',selected);btn.setAttribute('aria-pressed',String(selected));
    });
  }
  $$('[data-ex-sale]').forEach(btn=>btn.addEventListener('click',()=>{
    state.sale=Number(btn.dataset.exSale);state.item=btn.dataset.exItem;showMerchantStage(0);
  }));
  $('#ex-merchant-invoice').addEventListener('click',()=>showMerchantStage(1));
  $('#ex-merchant-paid').addEventListener('click',()=>showMerchantStage(2));
  $$('[data-ex-merchant-back]').forEach(btn=>btn.addEventListener('click',()=>showMerchantStage(0)));
  $('#ex-merchant-new').addEventListener('click',()=>showMerchantStage(0));

  /* 04 / forward-looking recurring buy concept: chart is deposits, not gains */
  const slider=$('#ex-stack-slider');
  const moneyWhole=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
  function renderStack(){
    const n=Number(slider.value);
    $('#ex-stack-value').textContent=moneyWhole(n);
    $('#ex-stack-total').textContent=moneyWhole(n*4)+' planned';
    $('#ex-stack-caption').textContent='4 '+(state.frequency==='week'?'weekly':'monthly')+' contributions';
    slider.style.background=`linear-gradient(90deg,#F7931A ${Math.round((n-10)/240*100)}%,#524D40 0)`;
    $$('[data-ex-frequency]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.exFrequency===state.frequency)));
    $$('[data-ex-bar]').forEach((bar,i)=>{
      // Each column represents total contributions through that period.
      const base=28+Math.round((n/250)*30);
      const height=Math.min(94,Math.round(base*(i+1)/4+14*(i+1)/4));
      bar.style.setProperty('--bar-height',height+'%');
      bar.setAttribute('aria-label',moneyWhole(n*(i+1))+' total planned after '+(i+1)+' contributions');
    });
  }
  slider.addEventListener('input',renderStack);
  $$('[data-ex-frequency]').forEach(btn=>btn.addEventListener('click',()=>{state.frequency=btn.dataset.exFrequency;renderStack()}));
  renderCustody();renderRoute();showMerchantStage(0);renderStack();activate('wallet');
})();
