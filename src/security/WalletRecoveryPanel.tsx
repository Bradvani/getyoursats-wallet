import {useEffect,useState} from 'react';
import {useWallet} from '../contexts/WalletContext';
import {usePresentation} from '../hooks/usePresentation';
import {getSignedRecovery} from './signedRecoveryController';
import {subscribeRecoveries,recoveryUnresolved,type RecoveryRecord} from './signedRecoveryJournal';
import {EXIT_PLAN_STORAGE_PREFIX,EXIT_PENDING_STORAGE_PREFIX} from '../features/unilateral-exit/removalProtection';
const COPY={
 en:{title:'Pending Bitcoin recovery',body:'Keep this wallet on the device. Resume uses the same signed transactions, not a new payment.',check:'Check confirmation',resume:'Resume signed recovery',adopt:'Load saved signed exit',busy:'Checking…',pending:'A pending exit is preserved. Creating or rebuilding its transactions still requires separate authorization.',unconfirmed:'Submitted does not mean confirmed. A connection error must not be retried as a new payment.',error:'Recovery could not continue. Your existing data has been kept.',details:'Details'},
 hi:{title:'बिटकॉइन रिकवरी लंबित है',body:'वॉलेट इस डिवाइस पर रखें। जारी करने से वही हस्ताक्षरित लेनदेन भेजे जाते हैं, नया भुगतान नहीं।',check:'पुष्टि जाँचें',resume:'हस्ताक्षरित रिकवरी जारी करें',adopt:'सहेजा गया हस्ताक्षरित एग्ज़िट खोलें',busy:'जाँच जारी है…',pending:'लंबित एग्ज़िट सुरक्षित है। नया लेनदेन बनाने के लिए अलग अनुमति चाहिए।',unconfirmed:'भेजे जाने का अर्थ पुष्टि नहीं है। कनेक्शन त्रुटि पर नया भुगतान न करें।',error:'रिकवरी आगे नहीं बढ़ सकी। आपका डेटा सुरक्षित रखा गया है।',details:'विवरण'},
 es:{title:'Recuperación de Bitcoin pendiente',body:'Conserva esta cartera en el dispositivo. Reanudar utiliza las mismas transacciones firmadas, no un nuevo pago.',check:'Comprobar confirmación',resume:'Reanudar recuperación firmada',adopt:'Cargar salida firmada guardada',busy:'Comprobando…',pending:'La salida pendiente se conserva. Crear o reconstruir transacciones requiere otra autorización.',unconfirmed:'Enviada no significa confirmada. No repitas un pago por un error de conexión.',error:'No se pudo continuar. Los datos existentes se han conservado.',details:'Detalles'},
 pt:{title:'Recuperação de Bitcoin pendente',body:'Mantenha esta carteira no dispositivo. Retomar usa as mesmas transações assinadas, não um novo pagamento.',check:'Verificar confirmação',resume:'Retomar recuperação assinada',adopt:'Carregar saída assinada guardada',busy:'A verificar…',pending:'A saída pendente está preservada. Criar ou reconstruir transações exige outra autorização.',unconfirmed:'Enviada não significa confirmada. Não repita um pagamento após um erro de ligação.',error:'Não foi possível continuar. Os dados existentes foram preservados.',details:'Detalhes'},
} as const;
function hasPrefix(prefix:string):boolean{
 for(let i=0;i<localStorage.length;i++)if(localStorage.key(i)?.startsWith(prefix))return true;
 return false;
}
export default function WalletRecoveryPanel(){
 const wallet=useWallet(),controller=getSignedRecovery(wallet);
 const {language}=usePresentation(),copy=COPY[language as keyof typeof COPY]??COPY.en;
 const [records,setRecords]=useState<ReadonlyArray<RecoveryRecord>>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!controller)return;
  let active=true,sequence=0;
  const refresh=()=>{const n=++sequence;void controller.list().then(r=>{if(active&&n===sequence)setRecords(r);}).catch(()=>{if(active)setError('Recovery records could not be read. Do not clear site data.');});};
  refresh();const unsubscribe=subscribeRecoveries(refresh);
  return()=>{active=false;sequence++;unsubscribe();};
 },[controller]);
 if(!controller)return null;
 const pending=records.filter(recoveryUnresolved),saved=hasPrefix(EXIT_PLAN_STORAGE_PREFIX),unsigned=hasPrefix(EXIT_PENDING_STORAGE_PREFIX);
 if(!pending.length&&!saved&&!unsigned&&!error)return null;
 const act=async(action:()=>Promise<unknown>)=>{
  if(busy)return;setBusy(true);setError('');
  try{await action();setRecords(await controller.list());}
  catch(e){setError(e instanceof Error?e.message:'Recovery unavailable');}
  finally{setBusy(false);}
 };
 return <section aria-label={copy.title} className="m-4 space-y-3 rounded-xl border border-spark-border bg-spark-surface p-4 text-spark-text-primary">
  <h2 className="font-semibold">{copy.title}</h2><p className="text-sm text-spark-text-secondary">{copy.body}</p>
  {pending.map(record=><div key={record.operationId} className="space-y-2 rounded-lg border border-spark-border p-3">
   <p className="text-sm break-all">{record.destination}</p>
   <p className="text-xs text-spark-text-secondary">{record.purpose==='refund'?'Refund':'Bitcoin exit'} · {record.state}</p>
   <div className="flex flex-wrap gap-2">
    <button type="button" disabled={busy} onClick={()=>void act(()=>controller.check(record.operationId))} className="min-h-11 rounded-lg border border-spark-border px-3 text-sm disabled:opacity-50">{busy?copy.busy:copy.check}</button>
    <button type="button" disabled={busy} onClick={()=>void act(()=>controller.resume(record.operationId))} className="min-h-11 rounded-lg border border-spark-border px-3 text-sm disabled:opacity-50">{copy.resume}</button>
   </div>
  </div>)}
  {saved&&<button type="button" disabled={busy} onClick={()=>void act(()=>controller.adoptPendingExit())} className="min-h-11 rounded-lg border border-spark-border px-3 text-sm disabled:opacity-50">{copy.adopt}</button>}
  {unsigned&&<p className="text-sm text-spark-text-secondary">{copy.pending}</p>}
  {error&&<div role="alert"><p className="text-sm">{copy.error}</p><details className="text-xs"><summary>{copy.details}</summary><p>{error}</p></details></div>}
  <p className="text-xs text-spark-text-secondary">{copy.unconfirmed}</p>
 </section>;
}
