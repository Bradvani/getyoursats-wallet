import type {Payment} from '@breeztech/breez-sdk-spark';
/** Deliberately stricter than the UI's age-limited conversion toggle. */
export function blocksWalletRemoval(payments:Payment[],exitActive:boolean):boolean {
 return exitActive||payments.some(p=>p.status==='pending'||p.conversionDetails?.status==='pending');
}

export type RemovalResult='removed'|'blocked'|'cancelled'|'unavailable';
export async function runVerifiedRemoval(args:{read:(offset:number)=>Promise<{payments:Payment[]}>;isCurrent:()=>boolean;erase:()=>void|Promise<void>}):Promise<RemovalResult>{
 try{
  for(let page=0;page<100;page++){
   if(!args.isCurrent())return 'cancelled';
   const result=await args.read(page*100);
   if(!args.isCurrent())return 'cancelled';
   if(!result||!Array.isArray(result.payments))return 'unavailable';
   if(blocksWalletRemoval(result.payments,false))return 'blocked';
   if(result.payments.length<100){
    if(!args.isCurrent())return 'cancelled';
    await args.erase();return 'removed';
   }
  }
  return 'unavailable';
 }catch{return 'unavailable';}
}
