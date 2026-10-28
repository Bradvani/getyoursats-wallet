import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({controller:{status:vi.fn(),reconcile:vi.fn()},enabled:true}));
vi.mock('../contexts/WalletContext',()=>({useWallet:()=>({})}));
vi.mock('./operationGateway',()=>({getOperationReconciliation:()=>state.enabled?state.controller:null}));
import PaymentReconciliationBanner from './PaymentReconciliationBanner';
beforeEach(()=>{vi.clearAllMocks();state.enabled=true;state.controller.status.mockResolvedValue([{state:'unknown'}]);});
describe('uncertain payment status UI',()=>{
 it('keeps repayment warning when a status check finds no conclusive result',async()=>{
  state.controller.reconcile.mockResolvedValue([{state:'unknown'}]);
  render(<PaymentReconciliationBanner/>);
  const check=await screen.findByRole('button',{name:'Check payment status'});
  fireEvent.click(check);
  await waitFor(()=>expect(state.controller.reconcile).toHaveBeenCalledOnce());
  expect(await screen.findByText(/Sending and wallet removal are paused/)).toBeInTheDocument();
 });
 it('removes the warning only when the controller confirms completion',async()=>{
  state.controller.reconcile.mockResolvedValue([{state:'completed'}]);
  render(<PaymentReconciliationBanner/>);
  fireEvent.click(await screen.findByRole('button',{name:'Check payment status'}));
  await waitFor(()=>expect(screen.queryByRole('region',{name:'Payment status'})).not.toBeInTheDocument());
 });
 it('keeps a recovery warning when status storage cannot be read',async()=>{
  state.controller.status.mockRejectedValue(new Error('corrupt'));
  render(<PaymentReconciliationBanner/>);
  expect(await screen.findByText(/Payment status could not be read/)).toBeInTheDocument();
 });
 it('does not expose browser journal UI for native or unguarded SDKs',async()=>{
  state.enabled=false;
  await act(async()=>{render(<PaymentReconciliationBanner/>)});
  expect(state.controller.status).not.toHaveBeenCalled();
  expect(screen.queryByRole('region',{name:'Payment status'})).not.toBeInTheDocument();
 });
});
