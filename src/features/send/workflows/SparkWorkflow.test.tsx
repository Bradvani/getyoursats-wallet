import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {ToastProvider} from '@/contexts/ToastContext';
import {WalletProvider} from '@/contexts/WalletContext';
import {FiatDataProvider} from '@/contexts/FiatDataContext';
import {StableBalanceProvider} from '@/contexts/StableBalanceContext';
import {createMockClient} from '@/test/mocks/mockWalletApi';
import type {SendPaymentMethod} from '@breeztech/breez-sdk-spark';
import SparkWorkflow from './SparkWorkflow';
describe('Spark quote confirmation',()=>{
 it.each([undefined,-1n,BigInt(Number.MAX_SAFE_INTEGER)+1n])('blocks a missing or invalid fee (%s) without presenting zero',fee=>{
  const send=vi.fn();
  render(<ToastProvider><WalletProvider client={createMockClient()} isConnected><FiatDataProvider><StableBalanceProvider>
   <SparkWorkflow method={{type:'sparkAddress',address:'spark1fixture',fee} as SendPaymentMethod & {type:'sparkAddress'}} amountSats={1000n} balanceSats={100_000} onBack={vi.fn()} onSend={send}/>
  </StableBalanceProvider></FiatDataProvider></WalletProvider></ToastProvider>);
  expect(screen.getByText('Couldn’t get a quote')).toBeInTheDocument();
  expect(screen.getByText('Network fee').parentElement).toHaveTextContent('—');
  const button=screen.getByTestId('send-confirm-button');expect(button).toBeDisabled();
  fireEvent.click(button);expect(send).not.toHaveBeenCalled();
 });

});

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
