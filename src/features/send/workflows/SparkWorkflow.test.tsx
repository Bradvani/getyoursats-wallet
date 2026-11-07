import {expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {WalletProvider} from '@/contexts/WalletContext';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';
import {createMockClient} from '@/test/mocks/mockWalletApi';
import SparkWorkflow from './SparkWorkflow';

function show(fee:bigint){
  render(<WalletProvider client={createMockClient()} isConnected><FiatDataProvider><StableBalanceProvider>
    <SparkWorkflow method={{type:'sparkAddress',address:'spark1fixture',fee}} amountSats={100n} balanceSats={100}
      recipient={{label:'Recipient',value:'alice@getyoursats.com'}} onBack={()=>{}} onSend={vi.fn()}/>
  </StableBalanceProvider></FiatDataProvider></WalletProvider>);
}
it('shows the actual zero quote and the reviewed GYS recipient',()=>{
  show(0n);
  expect(screen.getByTestId('send-destination')).toHaveAttribute('title','alice@getyoursats.com');
  expect(screen.getByText('Network fee').parentElement).toHaveTextContent('0');
  expect(screen.getByTestId('send-confirm-button')).toBeEnabled();
});
it('includes a nonzero SDK fee in the total and the balance check',()=>{
  show(3n);
  expect(screen.getByText('Network fee').parentElement).toHaveTextContent('3');
  expect(screen.getAllByText('103').length).toBeGreaterThan(0);
  expect(screen.getByTestId('send-confirm-button')).toBeDisabled();
});
it('never turns an invalid SDK fee into an executable zero quote',()=>{
  show(-1n);
  expect(screen.getByTestId('send-confirm-button')).toBeDisabled();
  expect(screen.getByText('Couldn’t get a quote')).toBeVisible();
});
