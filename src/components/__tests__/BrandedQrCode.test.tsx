import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import BrandedQrCode from '../BrandedQrCode';

describe('GetYourSats branded payment QR',()=>{
  it('preserves the QR payload and uses the approved brand asset for ordinary invoices',()=>{
    const invoice='LNBC1'+'A'.repeat(160);
    const html=renderToStaticMarkup(<BrandedQrCode value={invoice} size={260} label="POS invoice QR"/>);
    expect(html).toContain('aria-label="POS invoice QR"');
    expect(html).toContain('/brand/monogram.svg');
    expect(html).toContain('<svg');
    expect(html).not.toContain('value="undefined"');
  });

  it('does not obscure unusually long requests with a central logo',()=>{
    const longInvoice='LNBC1'+'A'.repeat(650);
    const html=renderToStaticMarkup(<BrandedQrCode value={longInvoice} size={288}/>);
    expect(html).toContain('<svg');
    expect(html).not.toContain('/brand/monogram.svg');
  });
});
