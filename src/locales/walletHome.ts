import type {AppLanguage} from '../services/presentationPreferences';

type HomeCopy = {chooseName: string; checking: string; unavailable: string; copyAddress: string; openMarket: string};
export const WALLET_HOME: Record<AppLanguage, HomeCopy> = {
  en: {chooseName: 'Choose your username', checking: 'Checking your address…', unavailable: 'Address temporarily unavailable', copyAddress: 'Copy your Lightning address', openMarket: 'View Bitcoin market'},
  hi: {chooseName: 'अपना यूज़रनेम चुनें', checking: 'आपका पता जाँचा जा रहा है…', unavailable: 'पता अभी उपलब्ध नहीं है', copyAddress: 'अपना lightning पता कॉपी करें', openMarket: 'bitcoin बाज़ार देखें'},
  es: {chooseName: 'Elige tu nombre de usuario', checking: 'Comprobando tu dirección…', unavailable: 'Dirección no disponible temporalmente', copyAddress: 'Copiar tu dirección lightning', openMarket: 'Ver el mercado de bitcoin'},
  pt: {chooseName: 'Escolha o seu nome de utilizador', checking: 'A verificar o seu endereço…', unavailable: 'Endereço temporariamente indisponível', copyAddress: 'Copiar o seu endereço lightning', openMarket: 'Ver o mercado de bitcoin'},
  ja: {chooseName: 'ユーザー名を選ぶ', checking: 'アドレスを確認中…', unavailable: 'アドレスを一時的に利用できません', copyAddress: 'lightningアドレスをコピー', openMarket: 'bitcoin市場を見る'},
  th: {chooseName: 'เลือกชื่อผู้ใช้ของคุณ', checking: 'กำลังตรวจสอบที่อยู่ของคุณ…', unavailable: 'ที่อยู่ไม่พร้อมใช้งานชั่วคราว', copyAddress: 'คัดลอกที่อยู่ lightning ของคุณ', openMarket: 'ดูตลาด bitcoin'},
  vi: {chooseName: 'Chọn tên người dùng', checking: 'Đang kiểm tra địa chỉ…', unavailable: 'Địa chỉ tạm thời không khả dụng', copyAddress: 'Sao chép địa chỉ lightning của bạn', openMarket: 'Xem thị trường bitcoin'},
  ta: {chooseName: 'உங்கள் பயனர்பெயரைத் தேர்ந்தெடுக்கவும்', checking: 'உங்கள் முகவரி சரிபார்க்கப்படுகிறது…', unavailable: 'முகவரி தற்காலிகமாகக் கிடைக்கவில்லை', copyAddress: 'உங்கள் lightning முகவரியை நகலெடுக்கவும்', openMarket: 'bitcoin சந்தையைப் பார்க்கவும்'},
  ar: {chooseName: 'اختر اسم المستخدم', checking: 'جارٍ التحقق من عنوانك…', unavailable: 'العنوان غير متاح مؤقتًا', copyAddress: 'نسخ عنوان lightning الخاص بك', openMarket: 'عرض سوق bitcoin'},
  'zh-CN': {chooseName: '选择用户名', checking: '正在检查你的地址…', unavailable: '地址暂时不可用', copyAddress: '复制你的lightning地址', openMarket: '查看bitcoin市场'},
};
