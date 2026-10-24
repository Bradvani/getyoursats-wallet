import QRCode from 'react-qr-code';

/**
 * Human-scannable high-contrast payment QR with the approved GetYourSats monogram.
 * A very large payload falls back to an unobstructed QR: completing a payment
 * reliably matters more than decoration. This component never changes the
 * destination or payment-request bytes supplied to it.
 */
export default function BrandedQrCode({value,size=200,label='Payment QR code'}:{
  value:string;
  size?:number;
  label?:string;
}){
  // H correction leaves room for the small central mark on normal addresses
  // and invoices. Very long BOLT11 strings require lower density/clean pixels.
  const withMark=value.length<=600;
  const level=withMark?'H':'L';
  const markSize=Math.max(23,Math.min(34,Math.round(size*0.11)));
  return <div className="gys-branded-qr" role="img" aria-label={label}
    style={{width:size,height:size,maxWidth:'100%',position:'relative',flex:'none',marginInline:'auto'}}>
    <QRCode
      value={value}
      level={level}
      bgColor="#FFFFFF"
      fgColor="#0B0B0B"
      size={size}
      style={{display:'block',height:'auto',maxWidth:'100%',width:'100%'}}
    />
    {withMark&&<img src="/brand/monogram.svg" alt="" aria-hidden="true"
      className="gys-branded-qr__mark"
      style={{
        position:'absolute',left:'50%',top:'50%',transform:'translate(-50%,-50%)',
        width:markSize,height:markSize,border:'3px solid #FFFFFF',borderRadius:9,
        boxSizing:'content-box',pointerEvents:'none',background:'#FFFFFF'
      }}
    />}
  </div>;
}
