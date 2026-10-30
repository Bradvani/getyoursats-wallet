import type { AppLanguage } from '../services/presentationPreferences';

type Copy = {
  title: string;
  body: string;
  notSent: string;
  unavailable: string;
  changed: string;
};

const copy: Record<AppLanguage, Copy> = {
  en: {
    title: 'Confirm with your passkey',
    body: 'Use your device’s authentication to approve this payment.',
    notSent: 'Payment not sent. Confirm again with this wallet’s passkey.',
    unavailable: 'Payment not sent. Reopen your wallet with its passkey and try again.',
    changed: 'Payment details changed. Review them and confirm again. Nothing was sent.',
  },
  hi: {
    title: 'अपनी पासकी से पुष्टि करें',
    body: 'इस भुगतान को मंज़ूरी देने के लिए अपने डिवाइस पर प्रमाणीकरण करें।',
    notSent: 'भुगतान नहीं भेजा गया। इस वॉलेट की पासकी से फिर पुष्टि करें।',
    unavailable: 'भुगतान नहीं भेजा गया। पासकी से अपना वॉलेट फिर खोलें और कोशिश करें।',
    changed: 'भुगतान का विवरण बदल गया है। जाँचकर फिर पुष्टि करें। कुछ नहीं भेजा गया।',
  },
  es: {
    title: 'Confirma con tu clave de acceso',
    body: 'Usa la autenticación de tu dispositivo para aprobar este pago.',
    notSent: 'Pago no enviado. Confirma de nuevo con la clave de acceso de esta billetera.',
    unavailable: 'Pago no enviado. Abre de nuevo tu billetera con su clave de acceso e inténtalo otra vez.',
    changed: 'Los datos del pago cambiaron. Revísalos y confirma de nuevo. No se envió nada.',
  },
  pt: {
    title: 'Confirme com sua chave de acesso',
    body: 'Use a autenticação do seu dispositivo para aprovar este pagamento.',
    notSent: 'Pagamento não enviado. Confirme novamente com a chave de acesso desta carteira.',
    unavailable: 'Pagamento não enviado. Reabra sua carteira com a chave de acesso e tente novamente.',
    changed: 'Os dados do pagamento mudaram. Confira e confirme novamente. Nada foi enviado.',
  },
  ja: {
    title: 'パスキーで確認',
    body: 'デバイスの認証でこの支払いを承認してください。',
    notSent: '支払いは送信されていません。このウォレットのパスキーで再度確認してください。',
    unavailable: '支払いは送信されていません。パスキーでウォレットを開き直して再試行してください。',
    changed: '支払い内容が変更されました。内容を確認して再度承認してください。何も送信されていません。',
  },
  th: {
    title: 'ยืนยันด้วยพาสคีย์ของคุณ',
    body: 'ใช้การยืนยันตัวตนบนอุปกรณ์เพื่ออนุมัติการชำระเงินนี้',
    notSent: 'ยังไม่ได้ส่งการชำระเงิน โปรดยืนยันอีกครั้งด้วยพาสคีย์ของกระเป๋านี้',
    unavailable: 'ยังไม่ได้ส่งการชำระเงิน โปรดเปิดกระเป๋าอีกครั้งด้วยพาสคีย์แล้วลองใหม่',
    changed: 'รายละเอียดการชำระเงินเปลี่ยนไป โปรดตรวจสอบและยืนยันอีกครั้ง ยังไม่ได้ส่งเงิน',
  },
  vi: {
    title: 'Xác nhận bằng khóa truy cập',
    body: 'Dùng xác thực trên thiết bị để phê duyệt khoản thanh toán này.',
    notSent: 'Chưa gửi thanh toán. Hãy xác nhận lại bằng khóa truy cập của ví này.',
    unavailable: 'Chưa gửi thanh toán. Hãy mở lại ví bằng khóa truy cập và thử lại.',
    changed: 'Thông tin thanh toán đã thay đổi. Hãy kiểm tra và xác nhận lại. Chưa gửi tiền.',
  },
  ta: {
    title: 'உங்கள் பாஸ்கீ மூலம் உறுதிப்படுத்தவும்',
    body: 'இந்தப் பணப்பரிவர்த்தனையை அனுமதிக்க உங்கள் சாதனத்தில் அடையாளத்தை உறுதிப்படுத்தவும்.',
    notSent: 'பணம் அனுப்பப்படவில்லை. இந்த வாலட்டின் பாஸ்கீ மூலம் மீண்டும் உறுதிப்படுத்தவும்.',
    unavailable: 'பணம் அனுப்பப்படவில்லை. பாஸ்கீ மூலம் வாலட்டை மீண்டும் திறந்து முயலவும்.',
    changed: 'பரிவர்த்தனை விவரங்கள் மாறிவிட்டன. சரிபார்த்து மீண்டும் உறுதிப்படுத்தவும். பணம் அனுப்பப்படவில்லை.',
  },
  ar: {
    title: 'أكّد باستخدام مفتاح المرور',
    body: 'استخدم التحقق من الهوية على جهازك للموافقة على هذه الدفعة.',
    notSent: 'لم تُرسل الدفعة. أكّد مجددًا باستخدام مفتاح مرور هذه المحفظة.',
    unavailable: 'لم تُرسل الدفعة. افتح محفظتك مجددًا باستخدام مفتاح المرور وحاول مرة أخرى.',
    changed: 'تغيّرت تفاصيل الدفعة. راجعها وأكّد مجددًا. لم يُرسل أي مبلغ.',
  },
  'zh-CN': {
    title: '使用通行密钥确认',
    body: '请通过设备身份验证批准这笔付款。',
    notSent: '付款未发送。请使用此钱包的通行密钥再次确认。',
    unavailable: '付款未发送。请使用通行密钥重新打开钱包后重试。',
    changed: '付款详情已更改。请检查后再次确认。尚未发送任何款项。',
  },
};

export function sendAuthorizationCopy(language: AppLanguage): Copy {
  return copy[language];
}
