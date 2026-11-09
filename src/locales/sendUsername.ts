import type {AppLanguage} from '@/services/presentationPreferences';

export const SEND_USERNAME: Record<AppLanguage, {useAddress: string; placeholder: string}> = {
  en: {useAddress: 'Use address', placeholder: 'Username, address or invoice'},
  hi: {useAddress: 'पता इस्तेमाल करें', placeholder: 'यूज़रनेम, पता या इनवॉइस'},
  es: {useAddress: 'Usar dirección', placeholder: 'Nombre de usuario, dirección o factura'},
  pt: {useAddress: 'Usar endereço', placeholder: 'Nome de utilizador, endereço ou fatura'},
  ja: {useAddress: 'このアドレスを使用', placeholder: 'ユーザー名、アドレス、または請求書'},
  th: {useAddress: 'ใช้ที่อยู่นี้', placeholder: 'ชื่อผู้ใช้ ที่อยู่ หรือใบแจ้งหนี้'},
  vi: {useAddress: 'Dùng địa chỉ', placeholder: 'Tên người dùng, địa chỉ hoặc hóa đơn'},
  ta: {useAddress: 'முகவரியைப் பயன்படுத்து', placeholder: 'பயனர்பெயர், முகவரி அல்லது இன்வாய்ஸ்'},
  ar: {useAddress: 'استخدام العنوان', placeholder: 'اسم المستخدم أو العنوان أو الفاتورة'},
  'zh-CN': {useAddress: '使用地址', placeholder: '用户名、地址或发票'},
};
