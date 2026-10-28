import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({controller:{list:vi.fn(),discover:vi.fn(),claim:vi.fn(),reconcile:vi.fn()}}));
vi.mock('../contexts/WalletContext',()=>({useWallet:()=>({})}));
vi.mock('./incomingClaimController',()=>({getIncomingClaims:()=>state.controller}));
import IncomingPaymentsPanel from './IncomingPaymentsPanel';
import {INCOMING_CLAIM_EVENT} from './incomingClaimJournal';
const id='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.clearAllMocks();state.controller.list.mockResolvedValue([]);state.controller.discover.mockResolvedValue([{id,amount:500n}]);});
describe('incoming payment review',()=>{
 it('never discovers or claims automatically when the panel mounts',async()=>{
  await act(async()=>{render(<IncomingPaymentsPanel/>);});
  expect(state.controller.discover).not.toHaveBeenCalled();expect(state.controller.claim).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Check incoming payments'}));
  expect(await screen.findByRole('button',{name:'Review and claim'})).toBeInTheDocument();
  expect(state.controller.claim).not.toHaveBeenCalled();
 });
 it('removes the claim action after an uncertain attempt and retains the status check',async()=>{
  state.controller.claim.mockImplementation(async()=>{
   state.controller.list.mockResolvedValue([{paymentId:id,amountSats:'500',state:'uncertain'}]);
   window.dispatchEvent(new Event(INCOMING_CLAIM_EVENT));throw Error('Incoming payment outcome is uncertain');
  });
  render(<IncomingPaymentsPanel/>);fireEvent.click(screen.getByRole('button',{name:'Check incoming payments'}));
  fireEvent.click(await screen.findByRole('button',{name:'Review and claim'}));
  expect(await screen.findByRole('alert')).toHaveTextContent(/uncertain/);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Review and claim'})).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Check incoming payments'})).toBeEnabled();
  expect(state.controller.claim).toHaveBeenCalledOnce();
 });
});
