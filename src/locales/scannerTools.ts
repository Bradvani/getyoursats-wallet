import type {AppLanguage} from '../services/presentationPreferences';

// Short visible labels keep the camera controls comfortable on narrow phones.
// Full action descriptions remain on the buttons for assistive technology.
export const SCANNER_TOOLS: Record<AppLanguage,{gallery:string;light:string;flip:string}> = {
  en:{gallery:'Photos',light:'Light',flip:'Flip'},
  hi:{gallery:'तस्वीरें',light:'लाइट',flip:'बदलें'},
  es:{gallery:'Fotos',light:'Luz',flip:'Girar'},
  pt:{gallery:'Fotos',light:'Luz',flip:'Mudar'},
  ja:{gallery:'写真',light:'ライト',flip:'切替'},
  th:{gallery:'รูปภาพ',light:'ไฟฉาย',flip:'สลับ'},
  vi:{gallery:'Ảnh',light:'Đèn',flip:'Đổi'},
  ta:{gallery:'படங்கள்',light:'ஒளி',flip:'மாற்று'},
  ar:{gallery:'الصور',light:'إضاءة',flip:'تبديل'},
  'zh-CN':{gallery:'照片',light:'补光',flip:'切换'},
};
