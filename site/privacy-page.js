/* Text-only rendering: translations cannot inject markup or alter payment data. */
(() => {
 'use strict';
 const catalog=window.GYS_PRIVACY;
 if(!catalog)return;
 const names={en:'English',hi:'हिन्दी',es:'Español',pt:'Português',ja:'日本語',th:'ไทย',vi:'Tiếng Việt',ta:'தமிழ்',ar:'العربية','zh-CN':'简体中文'};
 const select=document.getElementById('gys-language');
 if(select)select.replaceChildren(...Object.entries(names).map(([code,name])=>new Option(name,code)));
 const text=(tag,value)=>{
  const node=document.createElement(tag);
  const parts=value.split(/(username@getyoursats\.com|GetYourSats|Bitcoin|Lightning|Spark|Breez|Upstash|Resend|Vercel|passkey|\b(?:BTC|USDT|USDC|PIN|PWA|KYC|SDK)\b)/g);
  parts.forEach((part,index)=>{if(index%2){const term=document.createElement('bdi');term.dir='ltr';term.translate=false;term.textContent=part;node.append(term);}else node.append(document.createTextNode(part));});
  return node;
 };
 const set=(selector,value)=>{const node=document.querySelector(selector);if(node)node.textContent=value;};
 const languageFor=raw=>{
  if(catalog[raw])return raw;
  const tag=(raw||'').toLowerCase();
  if(/^zh(-cn|-sg|-hans.*)?$/.test(tag))return 'zh-CN';
  const base=tag.split('-')[0];return catalog[base]?base:null;
 };
 function render(code){
  const lang=catalog[code]?code:'en',d=catalog[lang],u=d.ui;
  document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
  const fontId='gys-public-script-font';let font=document.getElementById(fontId);
  if(['hi','ja','th','vi','ta','ar','zh-CN'].includes(lang)){
   if(!font){font=document.createElement('link');font.id=fontId;font.rel='stylesheet';document.head.append(font);}
   const href='/locale-fonts/'+lang+'.css';if(font.getAttribute('href')!==href)font.href=href;
  }else font?.remove();
  document.title=u[0]+' | GetYourSats';
  document.querySelector('input[type=email]')?.setAttribute('dir','ltr');
  document.querySelector('meta[name="description"]')?.setAttribute('content',d.intro);
  if(select){select.value=lang;select.setAttribute('aria-label',u[3]);}
  set('.navbar label .sr-only',u[3]);
  set('.hero h1',d.title);set('.hero .lead',d.intro);set('.hero .eyebrow','GetYourSats / '+u[0]);
  set('#contact .eyebrow','GetYourSats');
  document.querySelector('.navbar')?.setAttribute('aria-label',u[9]);
  document.querySelector('.navbar>a')?.setAttribute('aria-label',u[8]);
  document.querySelector('.footer-links')?.setAttribute('aria-label',u[10]);
  set('.footer>span','© 2026 GetYourSats');
  const toc=document.querySelector('.toc');if(toc){toc.setAttribute('aria-label',u[4]);toc.replaceChildren(text('strong',u[4]));}
  const article=document.querySelector('article.prose');
  if(article){
   article.replaceChildren();const note=text('div','');note.className='note';note.append(text('p',d.warning));article.append(note);
   const groups=[[0],[1],[2,3],[4],[5,6],[7]];
   groups.forEach((indices,i)=>{
    const heading=text('h2',d.headings[i]);heading.id='section-'+(i+1);article.append(heading);
    const link=text('a',d.headings[i]);link.href='#'+heading.id;toc?.append(link);
    for(const index of indices)article.append(text('p',d.paragraphs[index]));
    if(i===4){const link=text('a',u[7]);link.href='#contact';article.append(link);}
   });
  }
  for(const a of document.querySelectorAll('.navbar a[href],.footer a[href]')){
   const url=new URL(a.href,location.href),path=url.pathname.replace(/\.html$/,'');
   if(url.hostname==='wallet.getyoursats.com')a.textContent=u[2];
   else if(path==='/privacy')a.textContent=u[0];else if(path==='/support')a.textContent=u[1];else if(path==='/delete-account')a.textContent=u[6];else if(path==='/'&&!a.querySelector('img'))a.textContent=u[5];
  }
  for(const a of document.querySelectorAll('a[href]')){
   if(a.getAttribute('href').startsWith('#'))continue;
   const url=new URL(a.href,location.href);
   if(!['getyoursats.com','www.getyoursats.com','wallet.getyoursats.com',location.hostname].includes(url.hostname))continue;
   url.searchParams.set('lang',lang);a.href=url.toString();
  }
  // The wallet origin has no contact endpoint. Continue to the website form.
  const fallback=document.getElementById('privacy-contact-link');if(fallback)fallback.textContent=u[7];
  try{localStorage.setItem('gys:language:v1',lang);localStorage.setItem('gys:help-lang',lang);}catch{/* Optional preference persistence. */}
 }
 window.GYSRenderPrivacy=render;
 let saved;try{saved=localStorage.getItem('gys:language:v1')||localStorage.getItem('gys:help-lang');}catch{}
 const query=new URL(location.href).searchParams.get('lang');
 const initial=languageFor(query)||languageFor(saved)||(navigator.languages||[]).map(languageFor).find(Boolean)||'en';
 render(initial);
 select?.addEventListener('change',()=>{render(select.value);const url=new URL(location.href);url.searchParams.set('lang',select.value);history.replaceState(null,'',url);});
})();
