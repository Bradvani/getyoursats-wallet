import {loadLocaleFonts} from '../locales/loadFonts';
import {ASIAN_LOCALES} from '../locales/asian';
export type AppLanguage = 'en' | 'hi' | 'es' | 'pt' | keyof typeof ASIAN_LOCALES;
export type AppearancePreference = 'dark' | 'orange' | 'system';
export type ResolvedAppearance = 'dark' | 'orange';

export const APP_LANGUAGES: ReadonlyArray<{code: AppLanguage; name: string; subtitle: string}> = [
  {code:'en',name:'English',subtitle:''},
  {code:'hi',name:'हिन्दी',subtitle:'Hindi'},
  {code:'es',name:'Español',subtitle:'Spanish'},
  {code:'pt',name:'Português',subtitle:'Portuguese'},
  {code:'ja',name:'日本語',subtitle:'Japanese'},
  {code:'th',name:'ไทย',subtitle:'Thai'},
  {code:'vi',name:'Tiếng Việt',subtitle:'Vietnamese'},
  {code:'ta',name:'தமிழ்',subtitle:'Tamil'},
  {code:'ar',name:'العربية',subtitle:'Arabic'},
  {code:'zh-CN',name:'简体中文',subtitle:'Simplified Chinese'}
];

const LANGUAGE_KEY='gys:language:v1';
const APPEARANCE_KEY='gys:appearance:v1';
const EVENT='gys:presentation-pref-changed';
const langCodes=new Set<AppLanguage>(APP_LANGUAGES.map(item=>item.code));
const themeCodes=new Set<AppearancePreference>(['dark','orange','system']);

function safeRead(key:string): string|null {
  try {return localStorage.getItem(key);}catch{return null;}
}
export function getAppLanguage(): AppLanguage {
  if(typeof window!=='undefined'){
    const requested=new URLSearchParams(window.location.search).get('lang') as AppLanguage;
    if(langCodes.has(requested)){try{localStorage.setItem(LANGUAGE_KEY,requested);}catch{/* optional preference storage */}return requested;}
  }
  const value=safeRead(LANGUAGE_KEY) as AppLanguage;
  if(value)return langCodes.has(value)?value:'en';
  return detectAppLanguage(typeof navigator==='undefined'?[]:navigator.languages);
}
export function detectAppLanguage(languages:readonly string[]):AppLanguage {
  for(const raw of languages){
    const tag=raw.toLowerCase();
    if(tag==='zh'||tag==='zh-cn'||tag==='zh-sg'||tag.startsWith('zh-hans'))return 'zh-CN';
    const base=tag.split('-')[0] as AppLanguage;
    if(langCodes.has(base))return base;
  }
  return 'en';
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
  if(typeof window!=='undefined' && new URLSearchParams(window.location.search).has('lang')){
    const url=new URL(window.location.href);url.searchParams.set('lang',value);window.history.replaceState(null,'',url);
  }
  applyLanguage(value);
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
export function applyLanguage(language:AppLanguage):void {
  if(typeof document==='undefined')return;
  if(!['en','es','pt'].includes(language))void loadLocaleFonts();
  document.documentElement.lang=language;
  document.documentElement.dir=language==='ar'?'rtl':'ltr';
}
export function initPresentation(): void {
  applyAppearance();
  applyLanguage(getAppLanguage());
}
export const PUBLIC_LANGUAGE_QUERY=(lang:AppLanguage):string=>'?lang='+encodeURIComponent(lang);

const navCopy={
 'ja':ASIAN_LOCALES['ja'].nav,
 'th':ASIAN_LOCALES['th'].nav,
 'vi':ASIAN_LOCALES['vi'].nav,
 'ta':ASIAN_LOCALES['ta'].nav,
 'ar':ASIAN_LOCALES['ar'].nav,
 'zh-CN':ASIAN_LOCALES['zh-CN'].nav,

 en:{settings:'Settings',currency:'Currencies',scan:'Scan QR',pointOfSale:'Point of Sale',recurring:'Recurring Buys',buy:'Buy Bitcoin',logout:'Remove wallet from this device',help:'Help & information',privacy:'Privacy',support:'Support',appearance:'Appearance',language:'Language',display:'Display',dark:'Dark',orange:'Orange',system:'System',comingSoon:'Coming soon'},
 hi:{settings:'सेटिंग्स',currency:'मुद्राएँ',scan:'QR स्कैन',pointOfSale:'बिक्री काउंटर',recurring:'नियमित खरीद',buy:'Bitcoin खरीदें',logout:'इस डिवाइस से वॉलेट हटाएँ',help:'मदद और जानकारी',privacy:'गोपनीयता',support:'सहायता',appearance:'रूप-रंग',language:'भाषा',display:'डिस्प्ले',dark:'डार्क',orange:'ऑरेंज',system:'सिस्टम',comingSoon:'जल्द आ रहा है'},
 es:{settings:'Ajustes',currency:'Monedas',scan:'Escanear QR',pointOfSale:'Punto de venta',recurring:'Compras periódicas',buy:'Comprar Bitcoin',logout:'Eliminar cartera de este dispositivo',help:'Ayuda e información',privacy:'Privacidad',support:'Soporte',appearance:'Apariencia',language:'Idioma',display:'Pantalla',dark:'Oscuro',orange:'Naranja',system:'Sistema',comingSoon:'Próximamente'},
 pt:{settings:'Definições',currency:'Moedas',scan:'Ler QR',pointOfSale:'Ponto de venda',recurring:'Compras recorrentes',buy:'Comprar Bitcoin',logout:'Remover carteira deste dispositivo',help:'Ajuda e informações',privacy:'Privacidade',support:'Suporte',appearance:'Aparência',language:'Idioma',display:'Ecrã',dark:'Escuro',orange:'Laranja',system:'Sistema',comingSoon:'Em breve'}
} as const;
export function appCopy(lang:AppLanguage=getAppLanguage()) {return navCopy[lang];}

export const HOME_COPY: Record<AppLanguage, {
  scarcity:string; eyebrow:string; heading:string; emphasis:string; subtitle:string;
  start:string; restoreQuestion:string; restore:string; passkey:string;
  footOne:string; footTwo:string;
}> = {
 'ja':ASIAN_LOCALES['ja'].home,
 'th':ASIAN_LOCALES['th'].home,
 'vi':ASIAN_LOCALES['vi'].home,
 'ta':ASIAN_LOCALES['ta'].home,
 'ar':ASIAN_LOCALES['ar'].home,
 'zh-CN':ASIAN_LOCALES['zh-CN'].home,
 en:{scarcity:'21 MILLION. EVER.',eyebrow:'BITCOIN HAS A LIMIT',heading:'Every sat',emphasis:'counts.',subtitle:'Only 21 million bitcoin will ever exist. Keep yours close, move it in seconds, and accept payments over Lightning.',start:'Start',restoreQuestion:'Have a GetYourSats wallet?',restore:'Restore it',passkey:'Create a wallet with a supported device passkey. Your device may use biometrics or a screen lock. Keep your recovery options private in Settings.',footOne:'BITCOIN FIRST.',footTwo:'SATS ARE SCARCE.'},
 hi:{scarcity:'केवल 2.1 करोड़ BTC',eyebrow:'Bitcoin की आपूर्ति सीमित है',heading:'हर sat',emphasis:'मायने रखता है।',subtitle:'Bitcoin की अधिकतम आपूर्ति लगभग 2.1 करोड़ BTC है। अपने sats सुरक्षित रखें और Lightning से भुगतान करें।',start:'शुरू करें',restoreQuestion:'पहले से वॉलेट है?',restore:'वापस पाएं',passkey:'समर्थित डिवाइस पासकी से वॉलेट बनाएं। सेटिंग्स में रिकवरी के सुरक्षित विकल्प देखें।',footOne:'Bitcoin पहले।',footTwo:'sats सीमित हैं।'},
 es:{scarcity:'21 MILLONES. SIEMPRE.',eyebrow:'BITCOIN TIENE UN LÍMITE',heading:'Cada sat',emphasis:'cuenta.',subtitle:'La oferta de bitcoin tiene un límite cercano a 21 millones. Guárdalos y paga en segundos con Lightning.',start:'Empezar',restoreQuestion:'¿Ya tienes un monedero?',restore:'Restaurar',passkey:'Crea un monedero con una passkey compatible del dispositivo. Consulta tus opciones de recuperación en Ajustes.',footOne:'BITCOIN PRIMERO.',footTwo:'LOS SATS SON ESCASOS.'},
 pt:{scarcity:'21 MILHÕES. SEMPRE.',eyebrow:'BITCOIN TEM UM LIMITE',heading:'Cada sat',emphasis:'conta.',subtitle:'A oferta de bitcoin aproxima-se de um máximo de 21 milhões. Proteja os seus sats e pague rapidamente com Lightning.',start:'Começar',restoreQuestion:'Já tem carteira?',restore:'Restaurar',passkey:'Crie uma carteira com uma passkey suportada pelo dispositivo. Consulte as opções de recuperação nas Definições.',footOne:'BITCOIN PRIMEIRO.',footTwo:'SATS SÃO ESCASSOS.'}
};
export function homeCopy(lang:AppLanguage=getAppLanguage()){return HOME_COPY[lang];}
export const WALLET_COPY:Record<AppLanguage,{
 lightning:string;accept:string;soon:string;history:string;hideHistory:string;send:string;receive:string;scan:string;scanPayment:string;acceptShort:string;posPayment:string
}> = {
 'ja':ASIAN_LOCALES['ja'].wallet,
 'th':ASIAN_LOCALES['th'].wallet,
 'vi':ASIAN_LOCALES['vi'].wallet,
 'ta':ASIAN_LOCALES['ta'].wallet,
 'ar':ASIAN_LOCALES['ar'].wallet,
 'zh-CN':ASIAN_LOCALES['zh-CN'].wallet,
 en:{lightning:'Your Lightning address',accept:'Accept a payment',soon:'Coming soon',history:'History',hideHistory:'Hide history',send:'Send',receive:'Receive',scan:'Scan',scanPayment:'Scan payment QR',acceptShort:'Accept',posPayment:'Accept a payment in merchant mode'},
 hi:{lightning:'आपका Lightning पता',accept:'भुगतान स्वीकारें',soon:'जल्द आ रहा है',history:'इतिहास',hideHistory:'इतिहास छिपाएँ',send:'भेजें',receive:'प्राप्त करें',scan:'स्कैन',scanPayment:'भुगतान QR स्कैन करें',acceptShort:'भुगतान लें',posPayment:'व्यापारी मोड में भुगतान लें'},
 es:{lightning:'Tu dirección Lightning',accept:'Aceptar un pago',soon:'Próximamente',history:'Historial',hideHistory:'Ocultar historial',send:'Enviar',receive:'Recibir',scan:'Escanear',scanPayment:'Escanear QR de pago',acceptShort:'Cobrar',posPayment:'Cobrar en modo comercio'},
 pt:{lightning:'O seu endereço Lightning',accept:'Aceitar pagamento',soon:'Em breve',history:'Histórico',hideHistory:'Ocultar histórico',send:'Enviar',receive:'Receber',scan:'Ler QR',scanPayment:'Ler código QR de pagamento',acceptShort:'Cobrar',posPayment:'Cobrar no modo comerciante'}
};
