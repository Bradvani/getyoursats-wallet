import type {AppLanguage} from '../services/presentationPreferences';

type HomeCopy = {chooseName: string; checking: string; unavailable: string; copyAddress: string; openMarket: string; closeMarket: string};
export const WALLET_HOME: Record<AppLanguage, HomeCopy> = {
  en: {chooseName: 'Choose your username', checking: 'Checking your address…', unavailable: 'Address temporarily unavailable', copyAddress: 'Copy your Lightning address', openMarket: 'Expand Bitcoin market', closeMarket: 'Collapse Bitcoin market'},
  hi: {chooseName: 'अपना यूज़रनेम चुनें', checking: 'आपका पता जाँचा जा रहा है…', unavailable: 'पता अभी उपलब्ध नहीं है', copyAddress: 'अपना lightning पता कॉपी करें', openMarket: 'bitcoin बाज़ार विस्तार से दिखाएँ', closeMarket: 'bitcoin बाज़ार संक्षिप्त करें'},
  es: {chooseName: 'Elige tu nombre de usuario', checking: 'Comprobando tu dirección…', unavailable: 'Dirección no disponible temporalmente', copyAddress: 'Copiar tu dirección lightning', openMarket: 'Expandir el mercado de bitcoin', closeMarket: 'Contraer el mercado de bitcoin'},
  pt: {chooseName: 'Escolha o seu nome de utilizador', checking: 'A verificar o seu endereço…', unavailable: 'Endereço temporariamente indisponível', copyAddress: 'Copiar o seu endereço lightning', openMarket: 'Expandir o mercado de bitcoin', closeMarket: 'Recolher o mercado de bitcoin'},
  ja: {chooseName: 'ユーザー名を選ぶ', checking: 'アドレスを確認中…', unavailable: 'アドレスを一時的に利用できません', copyAddress: 'lightningアドレスをコピー', openMarket: 'bitcoin市場を展開', closeMarket: 'bitcoin市場を折りたたむ'},
  th: {chooseName: 'เลือกชื่อผู้ใช้ของคุณ', checking: 'กำลังตรวจสอบที่อยู่ของคุณ…', unavailable: 'ที่อยู่ไม่พร้อมใช้งานชั่วคราว', copyAddress: 'คัดลอกที่อยู่ lightning ของคุณ', openMarket: 'ขยายตลาด bitcoin', closeMarket: 'ย่อตลาด bitcoin'},
  vi: {chooseName: 'Chọn tên người dùng', checking: 'Đang kiểm tra địa chỉ…', unavailable: 'Địa chỉ tạm thời không khả dụng', copyAddress: 'Sao chép địa chỉ lightning của bạn', openMarket: 'Mở rộng thị trường bitcoin', closeMarket: 'Thu gọn thị trường bitcoin'},
  ta: {chooseName: 'உங்கள் பயனர்பெயரைத் தேர்ந்தெடுக்கவும்', checking: 'உங்கள் முகவரி சரிபார்க்கப்படுகிறது…', unavailable: 'முகவரி தற்காலிகமாகக் கிடைக்கவில்லை', copyAddress: 'உங்கள் lightning முகவரியை நகலெடுக்கவும்', openMarket: 'bitcoin சந்தையை விரிக்கவும்', closeMarket: 'bitcoin சந்தையைச் சுருக்கவும்'},
  ar: {chooseName: 'اختر اسم المستخدم', checking: 'جارٍ التحقق من عنوانك…', unavailable: 'العنوان غير متاح مؤقتًا', copyAddress: 'نسخ عنوان lightning الخاص بك', openMarket: 'توسيع سوق bitcoin', closeMarket: 'طي سوق bitcoin'},
  'zh-CN': {chooseName: '选择用户名', checking: '正在检查你的地址…', unavailable: '地址暂时不可用', copyAddress: '复制你的lightning地址', openMarket: '展开bitcoin市场', closeMarket: '收起bitcoin市场'},
};
