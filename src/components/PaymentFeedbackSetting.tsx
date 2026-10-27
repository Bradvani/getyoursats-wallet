import {useState} from 'react';
import {usePresentation} from '../hooks/usePresentation';
import {paymentHapticsEnabled,setPaymentHapticsEnabled} from '../utils/transferHaptics';
import type {AppLanguage} from '../services/presentationPreferences';
const labels:Record<AppLanguage,{title:string;detail:string}>={
 en:{title:'Payment haptics',detail:'Gentle feedback on confirmed payments, where supported.'},
 hi:{title:'भुगतान पर कंपन',detail:'समर्थित डिवाइस पर पुष्टि किए गए भुगतान के लिए हल्का कंपन।'},
 es:{title:'Vibración de pagos',detail:'Respuesta suave al confirmar pagos, si el dispositivo la permite.'},
 pt:{title:'Vibração nos pagamentos',detail:'Resposta suave em pagamentos confirmados, quando suportada.'},
 ja:{title:'支払い時の振動',detail:'対応端末では、支払いの確定時に軽く振動します。'},
 th:{title:'การสั่นเมื่อชำระเงิน',detail:'สั่นเบา ๆ เมื่อยืนยันการชำระเงิน หากอุปกรณ์รองรับ'},
 vi:{title:'Rung khi thanh toán',detail:'Rung nhẹ khi thanh toán được xác nhận, nếu thiết bị hỗ trợ.'},
 ta:{title:'பணம் செலுத்தும்போது அதிர்வு',detail:'ஆதரிக்கப்படும் சாதனங்களில் உறுதிப்படுத்தப்பட்ட பணப்பரிமாற்றங்களுக்கு மென்மையான அதிர்வு.'},
 ar:{title:'اهتزاز الدفع',detail:'اهتزاز لطيف عند تأكيد المدفوعات، على الأجهزة المدعومة.'},
 'zh-CN':{title:'付款触感反馈',detail:'在支持的设备上，付款确认时提供轻微振动。'},
};
export default function PaymentFeedbackSetting(){
 const {language}=usePresentation();const copy=labels[language];
 const [enabled,setEnabled]=useState(paymentHapticsEnabled);
 return <label className="flex items-center justify-between gap-4 pt-4 mt-3 border-t border-spark-border cursor-pointer">
  <span><span className="block text-sm font-semibold text-spark-text-primary">{copy.title}</span>
   <span className="block mt-1 text-xs text-spark-text-muted">{copy.detail}</span></span>
  <input type="checkbox" role="switch" checked={enabled} aria-label={copy.title}
   onChange={event=>{setPaymentHapticsEnabled(event.target.checked);setEnabled(event.target.checked);}}
   className="h-6 w-6 shrink-0 accent-[#F7931A]"/>
 </label>;
}
