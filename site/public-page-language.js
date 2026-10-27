/* Shared language shell for complete support and privacy pages. */
(() => {
 'use strict';
 const copies=window.GYS_SUPPORT,privacy=window.GYS_PRIVACY,select=document.getElementById('gys-language');
 if(!copies||!privacy||!select)return;
 const isSupport=document.body.dataset.helpPage==='support';
 const names={en:'English',hi:'हिन्दी',es:'Español',pt:'Português',ja:'日本語',th:'ไทย',vi:'Tiếng Việt',ta:'தமிழ்',ar:'العربية','zh-CN':'简体中文'};
 for(const [code,name] of Object.entries(names))if(!Array.from(select.options).some(o=>o.value===code))select.add(new Option(name,code));
 const element=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const set=(selector,text)=>{const n=document.querySelector(selector);if(n)n.textContent=text;};
 const group=(id,title,paragraphs)=>{
  const heading=document.getElementById(id);if(!heading)return;
  heading.textContent=title;
  let next=heading.nextElementSibling;
  while(next&&next.tagName!=='H2'&&next.tagName!=='SECTION'){const old=next;next=next.nextElementSibling;old.remove();}
  let previous=heading;
  for(const text of paragraphs){const p=element('p',text);previous.after(p);previous=p;}
 };
 function render(code){
  const lang=Object.hasOwn(copies,code)?code:'en',d=copies[lang],p=privacy[lang],u=p.ui;
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';select.value=lang;
  select.setAttribute('aria-label',u[3]);set('.navbar label .sr-only',u[3]);
  document.querySelector('.navbar')?.setAttribute('aria-label',d.main);
  document.querySelector('.navbar>a')?.setAttribute('aria-label','GetYourSats');
  document.querySelector('.footer-links')?.setAttribute('aria-label',d.footer);
  set('.footer>span','© 2026 GetYourSats');
  const article=document.querySelector('article.prose');if(article)article.lang=lang;
  let font=document.getElementById('gys-public-script-font');
  if(['hi','ja','th','vi','ta','ar','zh-CN'].includes(lang)){
   if(!font){font=document.createElement('link');font.id='gys-public-script-font';font.rel='stylesheet';document.head.append(font);}
   font.href='/locale-fonts/'+lang+'.css';
  }else font?.remove();
  if(isSupport){
   document.title=u[1]+' | GetYourSats';set('.hero h1',u[1]);set('.hero .lead',d.lead);set('.hero .eyebrow','GetYourSats / '+u[1]);
   document.querySelector('meta[name="description"]')?.setAttribute('content',d.lead);
   // Remove the superseded English-only scope notice; all support sections now have full catalogs.
   const intro=article?.querySelector(':scope > .eyebrow');if(intro){const paragraph=intro.nextElementSibling;if(paragraph?.tagName==='P')paragraph.remove();intro.remove();}
   const notice=article?.querySelector(':scope > .note');if(notice)notice.replaceChildren(element('p',d.notice));
   group('section-2',d.paymentTitle,[d.payment1,d.payment2]);
   group('section-3',d.merchantTitle,[d.merchant1,d.merchant2]);
   group('section-4',d.addressTitle,[d.address1,d.address2]);
   group('section-5',d.investigateTitle,[d.investigate]);
   const keys=document.getElementById('keys-and-recovery');
   if(keys){
    keys.replaceChildren(element('h2',d.keysTitle),...['keys1','keys2','keys3'].map(k=>element('p',d[k])));
    for(const [label,url] of [[d.security,'https://github.com/Bradvani/getyoursats-wallet/blob/main/SECURITY.md'],[d.capabilities,'https://github.com/Bradvani/getyoursats-wallet/blob/main/GETYOURSATS.md']]){
     const a=element('a',label);a.href=url;a.rel='noopener noreferrer';const p=element('p','');p.append(a);keys.append(p);
    }
   }
   const learn=document.getElementById('learn');if(learn){const a=element('a',d.learnNav);a.href=location.pathname.endsWith('.html')?'/learn.html':'/learn';learn.replaceChildren(element('h2',d.learnTitle),element('p',d.learn),a);}
   const labels={'#section-2':d.paymentTitle,'#section-3':d.merchantTitle,'#section-4':d.addressTitle,'#keys-and-recovery':d.keysTitle,'#contact':p.form.formTitle};
   for(const a of document.querySelectorAll('.toc a,.hero-actions a')){const value=labels[a.getAttribute('href')];if(value)a.textContent=value;}
   set('.toc strong',d.outline);document.querySelector('.toc')?.setAttribute('aria-label',d.outline);
   set('#contact .eyebrow','GetYourSats / '+p.form.formTitle);
   if(!document.getElementById('gys-contact')){
    set('#contact h2',p.form.formTitle);set('#contact .gys-contact-surface>p:not(.eyebrow)',d.contactFallback);set('#contact a.primary',d.openContact);
   }
  }
  // Keep names, addresses and form data intact. Only navigation labels and language queries change.
  for(const a of document.querySelectorAll('.navbar a[href],.footer a[href],.toc a[href],.hero-actions a[href]')){
   const url=new URL(a.href,location.href),path=url.pathname.replace(/\.html$/,'');
   if(a.getAttribute('href').startsWith('#'))continue;
   if(url.hostname==='wallet.getyoursats.com'&&path==='/')a.textContent=u[2];
   else if(path==='/privacy')a.textContent=u[0];else if(path==='/support')a.textContent=u[1];
   else if(path==='/learn')a.textContent=d.learnNav;else if(path==='/delete-account')a.textContent=u[6];
   else if(path==='/'&&!a.querySelector('img'))a.textContent=u[5];
  }
  for(const a of document.querySelectorAll('a[href]')){
   if(a.getAttribute('href').startsWith('#'))continue;const url=new URL(a.href,location.href);
   if(!['getyoursats.com','www.getyoursats.com','wallet.getyoursats.com',location.hostname].includes(url.hostname))continue;
   url.searchParams.set('lang',lang);a.href=url.toString();
  }
  document.querySelectorAll('input[type=email]').forEach(n=>n.dir='ltr');
  try{localStorage.setItem('gys:language:v1',lang);localStorage.setItem('gys:help-lang',lang);}catch{/* Optional storage. */}
 }
 select.addEventListener('change',()=>render(select.value));
 window.addEventListener('storage',event=>{if(event.key==='gys:language:v1'&&copies[event.newValue]){select.value=event.newValue;select.dispatchEvent(new Event('change'));}});
 render(select.value);
})();
