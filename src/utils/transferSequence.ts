/** Visual state follows payment evidence; it never authorizes, retries or completes a transfer. */
export type TransferPhase='preparing'|'processing'|'confirming'|'confirmed'|'failed'|'unknown';
export type TransferDirection='sent'|'received';
export interface TransferSequenceRecord {visual:number;percent:number;phase:TransferPhase;finished:boolean}
const records=new Map<string,TransferSequenceRecord>();
const MAX_RECORDS=512;
export const TRANSFER_SEQUENCE_DURATION_MS=5600;
export const VERIFIED_STEP_PERCENT={preparing:25,processing:50,confirming:75,confirmed:100} as const;
export function isInterrupted(phase:TransferPhase){return phase==='failed'||phase==='unknown';}
export function sequenceTarget(phase:TransferPhase):number{
 return phase==='preparing'?.18:phase==='processing'?.46:phase==='confirming'?.66:phase==='confirmed'?1:0;
}
export function sequenceKey(direction:TransferDirection,id:string){return `${direction}:${id}`;}
export function readSequence(key:string):TransferSequenceRecord|undefined{return records.get(key);}
export function saveSequence(key:string,record:TransferSequenceRecord){
 records.set(key,record);if(records.size>MAX_RECORDS)records.delete(records.keys().next().value!);
}
export function advanceEvidence(record:TransferSequenceRecord,phase:TransferPhase):TransferSequenceRecord{
 const percent=isInterrupted(phase)?Math.min(record.percent,75):VERIFIED_STEP_PERCENT[phase as keyof typeof VERIFIED_STEP_PERCENT];
 return {...record,phase,percent:phase==='confirmed'?100:isInterrupted(phase)?percent:Math.max(Math.min(record.percent,75),percent)};
}
/** Final orange coverage is withheld until actual confirmation. */
export function finalFillProgress(phase:TransferPhase,visual:number){
 return phase==='confirmed'?Math.max(0,Math.min(1,(visual-.72)/.28)):0;
}
export function bitcoinFill(direction:TransferDirection,visual:number){
 const value=Math.max(0,Math.min(1,visual));return direction==='received'?value:1-value;
}
