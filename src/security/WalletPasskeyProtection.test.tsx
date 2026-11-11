import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import WalletPasskeyProtection from './WalletPasskeyProtection';
const mocks=vi.hoisted(()=>({begin:vi.fn(),verify:vi.fn(),cancel:vi.fn(),remove:vi.fn()}));
vi.mock('./webWalletVault',()=>({hasLinkedWebPasskey:()=>false,beginWebPasskeyEnrollment:mocks.begin,removeWebPasskeyProtection:mocks.remove,exportWebPasskeyBackup:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();mocks.begin.mockResolvedValue({verify:mocks.verify,cancel:mocks.cancel});mocks.verify.mockResolvedValue(undefined);});
afterEach(cleanup);
describe('same-wallet protection UI',()=>{
 it('requires backup acknowledgement and a separate verification gesture',async()=>{
  render(<WalletPasskeyProtection/>);fireEvent.click(screen.getByRole('button',{name:'Add passkey protection'}));
  expect(screen.getByRole('button',{name:'Create protection passkey'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Wallet password'),{target:{value:'test-password-only'}});
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Create protection passkey'}));
  await screen.findByRole('button',{name:'Verify and finish'});
  expect(mocks.begin).toHaveBeenCalledWith('test-password-only',expect.any(AbortSignal));expect(mocks.verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Verify and finish'}));
  await screen.findByText('Passkey protection added. Your wallet is unchanged.');
  expect(mocks.verify).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Save encrypted recovery file'})).toBeVisible();
 });
 it('cancels the prepared link without invoking its commit',async()=>{
  const {unmount}=render(<WalletPasskeyProtection/>);fireEvent.click(screen.getByRole('button',{name:'Add passkey protection'}));
  fireEvent.change(screen.getByLabelText('Wallet password'),{target:{value:'test-password-only'}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Create protection passkey'}));await screen.findByRole('button',{name:'Verify and finish'});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(mocks.cancel).toHaveBeenCalled();expect(mocks.verify).not.toHaveBeenCalled();unmount();
 });
 it('does not present failed verification as an active link',async()=>{
  mocks.verify.mockRejectedValue(new DOMException('Cancelled','NotAllowedError'));
  render(<WalletPasskeyProtection/>);fireEvent.click(screen.getByRole('button',{name:'Add passkey protection'}));
  fireEvent.change(screen.getByLabelText('Wallet password'),{target:{value:'test-password-only'}});fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button',{name:'Create protection passkey'}));await screen.findByRole('button',{name:'Verify and finish'});fireEvent.click(screen.getByRole('button',{name:'Verify and finish'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toBeVisible());expect(screen.queryByRole('button',{name:'Save encrypted recovery file'})).toBeNull();
 });
});
