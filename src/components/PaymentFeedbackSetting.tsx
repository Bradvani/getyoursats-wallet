import {useId,useState} from 'react';
import {usePresentation} from '../hooks/usePresentation';
import {paymentHapticsEnabled,setPaymentHapticsEnabled,paymentVibrationSupported} from '../utils/transferHaptics';
import {CUSTOMER_SETTINGS} from '../locales/customerSettings';
import {Switch} from './ui';
export default function PaymentFeedbackSetting(){
 const {language}=usePresentation();const copy=CUSTOMER_SETTINGS[language];
 const id=useId();
 const [enabled,setEnabled]=useState(paymentHapticsEnabled);
 if(!paymentVibrationSupported())return null;
 return <div className="gys-setting-toggle border-t border-spark-border pt-4 mt-4">
  <div className="min-w-0">
   <h4 id={id} className="text-sm font-semibold text-spark-text-primary">{copy.vibration}</h4>
   <p id={`${id}-detail`} className="mt-1 text-xs leading-relaxed text-spark-text-muted">{copy.vibrationDetail}</p>
  </div>
  <Switch checked={enabled} aria-labelledby={id} aria-describedby={`${id}-detail`}
   onChange={()=>{setPaymentHapticsEnabled(!enabled);setEnabled(!enabled);}}/>
 </div>;
}
