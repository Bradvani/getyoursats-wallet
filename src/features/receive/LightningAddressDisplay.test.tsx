import {render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {ToastProvider} from '../../contexts/ToastContext';
import LightningAddressDisplay from './LightningAddressDisplay';
it('does not ask an existing custom-address owner to personalize the address again',()=>{
 render(<ToastProvider><LightningAddressDisplay address={{username:'alice',lightningAddress:'alice@getyoursats.com',description:'',lnurl:{bech32:'lnurl1test',url:'https://example.invalid'}}}
  section="details" isLoading={false} isSupported onEdit={vi.fn()} onCustomizeAmount={vi.fn()}/></ToastProvider>);
 expect(screen.getByTestId('lightning-address-text')).toHaveTextContent('alice@getyoursats.com');
 expect(screen.queryByText(/Personalize your address/)).toBeNull();
});
