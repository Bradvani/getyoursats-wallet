import type {InputType} from '@breeztech/breez-sdk-spark';
export function invoiceExpiresAt(parsed:InputType):number|null {
 if(parsed.type!=='bolt11Invoice')return null;
 const {timestamp,expiry}=parsed;
 return Number.isFinite(timestamp)&&Number.isFinite(expiry)&&timestamp>0&&expiry>0?(timestamp+expiry)*1000:null;
}
