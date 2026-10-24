export type AppLanguage = 'en' | 'hi' | 'es' | 'pt';
export type AppearancePreference = 'dark' | 'orange' | 'system';
export type ResolvedAppearance = 'dark' | 'orange';

export const APP_LANGUAGES: ReadonlyArray<{code: AppLanguage; name: string; subtitle: string}> = [
  {code:'en',name:'English',subtitle:'English'},
  {code:'hi',name:'हिन्दी',subtitle:'Hindi'},
  {code:'es',name:'Español',subtitle:'Spanish'},
  {code:'pt',name:'Português',subtitle:'Portuguese'}
];

const LANGUAGE_KEY='gys:language:v1';
const APPEARANCE_KEY='gys:appearance:v1';
const EVENT='gys:presentation-pref-changed';
const langCodes=new Set<AppLanguage>(['en','hi','es','pt']);
const themeCodes=new Set<AppearancePreference>(['dark','orange','system']);

function safeRead(key:string): string|null {
  try {return localStorage.getItem(key);}catch{return null;}
}
export function getAppLanguage(): AppLanguage {
  const value=safeRead(LANGUAGE_KEY) as AppLanguage;
  return langCodes.has(value)?value:'en';
}
export function getAppearancePreference(): AppearancePreference {
  const value=safeRead(APPEARANCE_KEY) as AppearancePreference;
  return themeCodes.has(value)?value:'dark';
}
export function getResolvedAppearance(preference:AppearancePreference=getAppearancePreference()):ResolvedAppearance {
  if(preference!=='system')return preference;
  return typeof window!=='undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches?'orange':'dark';
}
function publish(): void {
  if(typeof window!=='undefined')window.dispatchEvent(new Event(EVENT));
}
export function setAppLanguage(value:AppLanguage): void {
  if(!langCodes.has(value))throw new Error('Unsupported language');
  try{localStorage.setItem(LANGUAGE_KEY,value);}catch{/* transient environments */}
  if(typeof document!=='undefined')document.documentElement.lang=value;
  publish();
}
export function applyAppearance(): void {
  if(typeof document==='undefined')return;
  const resolved=getResolvedAppearance();
  const root=document.documentElement;
  root.dataset.gysTheme=resolved;
  root.style.colorScheme=resolved==='orange'?'light':'dark';
  const color=resolved==='orange'?'#FAF7F1':'#0B0B0B';
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(el=>{el.content=color;});
  const scheme=document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if(scheme)scheme.content=resolved==='orange'?'light':'dark';
}
export function setAppearancePreference(value:AppearancePreference): void {
  if(!themeCodes.has(value))throw new Error('Unsupported appearance');
  try{localStorage.setItem(APPEARANCE_KEY,value);}catch{/* transient environments */}
  applyAppearance();
  publish();
}
export function subscribePresentation(callback:()=>void):()=>void {
  if(typeof window==='undefined')return()=>{};
  window.addEventListener(EVENT,callback);
  const media=window.matchMedia?.('(prefers-color-scheme: light)');
  const systemListener=()=>{if(getAppearancePreference()==='system'){applyAppearance();callback();}};
  media?.addEventListener?.('change',systemListener);
  return()=>{window.removeEventListener(EVENT,callback);media?.removeEventListener?.('change',systemListener);};
}
export function initPresentation(): void {
  applyAppearance();
  if(typeof document!=='undefined')document.documentElement.lang=getAppLanguage();
}
export const PUBLIC_LANGUAGE_QUERY=(lang:AppLanguage):string=>'?lang='+encodeURIComponent(lang);

const navCopy={
 en:{settings:'Settings',currency:'Currencies',scan:'Scan QR',pointOfSale:'Point of Sale',recurring:'Recurring Buys',buy:'Buy Bitcoin',logout:'Log Out',help:'Help & information',privacy:'Privacy',support:'Support',appearance:'Appearance',language:'Language'},
 hi:{settings:'सेटिंग्स',currency:'मुद्राएँ',scan:'QR स्कैन',pointOfSale:'बिक्री काउंटर',recurring:'नियमित खरीद',buy:'बिटकॉइन खरीदें',logout:'लॉग आउट',help:'मदद और जानकारी',privacy:'गोपनीयता',support:'सहायता',appearance:'रूप-रंग',language:'भाषा'},
 es:{settings:'Ajustes',currency:'Monedas',scan:'Escanear QR',pointOfSale:'Punto de venta',recurring:'Compras periódicas',buy:'Comprar Bitcoin',logout:'Cerrar sesión',help:'Ayuda e información',privacy:'Privacidad',support:'Soporte',appearance:'Apariencia',language:'Idioma'},
 pt:{settings:'Definições',currency:'Moedas',scan:'Ler QR',pointOfSale:'Ponto de venda',recurring:'Compras recorrentes',buy:'Comprar Bitcoin',logout:'Terminar sessão',help:'Ajuda e informações',privacy:'Privacidade',support:'Suporte',appearance:'Aparência',language:'Idioma'}
} as const;
export function appCopy(lang:AppLanguage=getAppLanguage()) {return navCopy[lang];}
