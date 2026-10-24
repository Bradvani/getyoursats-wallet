import {DOMAIN,enabled,redis,validUsername,nameKey,checkSourceLNURL} from '../server/handleCore.mjs';

/**
 * Public LNURL-Pay discovery behind getyoursats.com/.well-known/lnurlp/:name.
 * Alias resolves to the wallet's *existing* Breez address; no spending keys
 * are held here. Returns the original Breez invoice callback/metadata
 * unmodified so the invoice description hash stays valid.
 */
export default async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store, max-age=0');
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.statusCode=405;return res.end(JSON.stringify({status:'ERROR',reason:'Method not allowed'}));}
 // The same Vercel project also serves wallet.getyoursats.com. A custom alias
 // must only be advertised on the domain it was allocated on.
 const host=String(req.headers.host||'').toLowerCase().split(':')[0];
 const username=typeof req.query.username==='string'?req.query.username:'';
 if(host!==DOMAIN||!enabled()||!validUsername(username)){
   res.statusCode=404;return res.end(JSON.stringify({status:'ERROR',reason:'Lightning address unavailable'}));
 }
 try{
   const raw=await redis('GET',nameKey(username));
   if(!raw){res.statusCode=404;return res.end(JSON.stringify({status:'ERROR',reason:'Lightning address unknown'}));}
   const claim=JSON.parse(raw);
   if(claim.username!==username||typeof claim.sourceAddress!=='string')throw Error('Invalid alias record');
   const pay=await checkSourceLNURL(claim.sourceAddress);
   // The callback is intentionally the trusted breez.tips host; payment goes
   // to the original SDK-managed non-custodial wallet.
   res.statusCode=200;return res.end(JSON.stringify(pay));
 }catch{
   res.statusCode=503;return res.end(JSON.stringify({status:'ERROR',reason:'Lightning address unavailable'}));
 }
}
