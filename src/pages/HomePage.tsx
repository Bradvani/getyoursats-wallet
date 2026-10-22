import {useState} from 'react';
type Props={onRestoreWallet:()=>void;onCreateNewWallet:()=>void;onUsePasskey:()=>void;onCreatePasskey:()=>void;prfAvailable:boolean};
export default function HomePage({onCreateNewWallet,onRestoreWallet}:Props) {
 const [busy,setBusy]=useState(false);
 return <main style={{minHeight:'100dvh',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',alignItems:'center',background:'#050505',color:'#f5f1eb',padding:'max(46px,env(safe-area-inset-top)) 24px max(34px,env(safe-area-inset-bottom))',textAlign:'center'}}>
 <div style={{fontSize:14,letterSpacing:'0.27em',fontWeight:800}}>GETYOURSATS</div>
 <section style={{display:'grid',justifyItems:'center',gap:27}}><img width={170} height={170} style={{objectFit:'contain',borderRadius:'24%'}} alt="GetYourSats" src="/assets/getyoursats-mark.jpg"/><div><h1 style={{fontSize:32,fontWeight:800,letterSpacing:'-0.045em'}}>Bitcoin. Simply yours.</h1><p style={{marginTop:12,color:'#aaa'}}>Save · Send · Receive</p></div></section>
 <section style={{display:'grid',gap:17,width:'100%',maxWidth:360}}><button data-testid="get-started-button" disabled={busy} onClick={()=>{setBusy(true);onCreateNewWallet()}} style={{background:'#ffcb2b',color:'#070707',borderRadius:16,padding:18,fontWeight:800,fontSize:18}}>{busy?'Starting…':'Start'}</button><button onClick={onRestoreWallet} style={{color:'#aaa',padding:10}}>Restore wallet</button></section>
 </main>;
}