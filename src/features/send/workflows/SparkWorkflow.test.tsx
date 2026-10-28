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
  expect(screen.getByText(/fee could not be verified/)).toBeInTheDocument();
  expect(screen.getByText('Network fee').parentElement).toHaveTextContent('—');
  const button=screen.getByTestId('send-confirm-button');expect(button).toBeDisabled();
  fireEvent.click(button);expect(send).not.toHaveBeenCalled();
 });
});
