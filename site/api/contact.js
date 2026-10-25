// Public GetYourSats support form. The API only accepts same-origin requests.
// Delivery is unavailable until Resend and a verified sender are configured.
const allowedOrigins=new Set(['https://getyoursats.com','https://www.getyoursats.com']);
const topicLabels=Object.freeze({
  support:'Wallet & payment help',
  feedback:'Product feedback & ideas',
  partnership:'Partnerships & affiliations',
  media:'Media & community collaborations',
  privacy:'Privacy & data requests',
  general:'General enquiry'
});
// Old cached forms may still submit former IDs. Route these privately
// without continuing to present misleading recovery or mining categories.
const legacyTopics=Object.freeze({
  wallet:'support',payment:'support',recovery:'support',mining:'general'
});
const attempts=new Map();
function respond(res,status,body){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 return res.status(status).json(body);
}
function available(){return Boolean(process.env.RESEND_API_KEY&&process.env.GETYOURSATS_SUPPORT_TO&&process.env.GETYOURSATS_SUPPORT_FROM)}
export default async function handler(req,res){
 if(req.method==='GET')return respond(res,200,{available:available()});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return respond(res,405,{error:'Method not allowed'})}
 if(!allowedOrigins.has(req.headers.origin))return respond(res,403,{error:'Unsupported origin'});
 if(!String(req.headers['content-type']||'').startsWith('application/json'))return respond(res,415,{error:'JSON required'});
 if(Number(req.headers['content-length']||0)>12000)return respond(res,413,{error:'Request too large'});
 let payload=req.body;
 if(typeof payload==='string'){try{payload=JSON.parse(payload)}catch{return respond(res,400,{error:'Invalid JSON'})}}
 if(!payload||typeof payload!=='object')return respond(res,400,{error:'Invalid request'});
 if(String(payload.website||'').trim())return respond(res,202,{ok:true}); // honeypot
 const email=String(payload.email||'').trim().slice(0,255);
 const name=String(payload.name||'').trim().slice(0,80);
 const requestedTopic=String(payload.topic||'').trim();
 const topic=Object.hasOwn(topicLabels,requestedTopic)
   ? requestedTopic
   : Object.hasOwn(legacyTopics,requestedTopic) ? legacyTopics[requestedTopic] : null;
 const message=String(payload.message||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)||email.length>254)return respond(res,400,{error:'Enter a valid reply email'});
 if(!topic)return respond(res,400,{error:'Choose an enquiry type'});
 const topicLabel=topicLabels[topic];
 if(message.length<15||message.length>2500)return respond(res,400,{error:'Your message must be 15–2500 characters'});
 if(payload.consent!==true)return respond(res,400,{error:'Please acknowledge the privacy reminder'});
 if(!available())return respond(res,503,{error:'Secure mail delivery is not available'});
 // Per-instance limit; add a Vercel WAF rate limit for network-wide protection.
 const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0].slice(0,80);
 const now=Date.now(),bucket=attempts.get(ip)||{start:now,count:0};
 if(now-bucket.start>3600000){bucket.start=now;bucket.count=0}
 if(bucket.count>=4)return respond(res,429,{error:'Too many attempts. Please try again later'});
 bucket.count++;attempts.set(ip,bucket);if(attempts.size>2000)attempts.clear();
 const reference='GYS-'+now.toString(36).toUpperCase().slice(-8);
 const text=[
  'GetYourSats website enquiry','Reference: '+reference,'Enquiry type: '+topicLabel,'Routing code: '+topic,'Name: '+(name||'Not supplied'),
  'Reply to: '+email,'',message.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,''),'',
  'Never request private keys, recovery words or PINs in any reply.'
 ].join('\n');
 try{
  const upstream=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':reference},
   body:JSON.stringify({from:process.env.GETYOURSATS_SUPPORT_FROM,to:[process.env.GETYOURSATS_SUPPORT_TO],reply_to:email,subject:'GetYourSats · '+topicLabel+' · '+reference,text}),
   signal:AbortSignal.timeout(9000)
  });
  if(!upstream.ok)return respond(res,502,{error:'Email provider could not accept the request'});
  return respond(res,202,{ok:true,reference});
 }catch{return respond(res,502,{error:'Email service unavailable. Please retry'})}
}
