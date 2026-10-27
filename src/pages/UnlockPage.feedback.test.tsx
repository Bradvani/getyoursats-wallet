import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import UnlockPage from './UnlockPage';
import {PASSKEY_INCOMPLETE_MESSAGE} from '../utils/passkeyUnlockFeedback';
vi.mock('../services/secureStorage',()=>({secureStorage:{isSupported:()=>false},getBiometryInfo:vi.fn(),confirmDeviceOwner:vi.fn()}));
vi.mock('../services/passkeyService',()=>({isPasskeyMode:()=>true}));
vi.mock('@/components/StartupLogo',()=>({default:()=>null}));
vi.mock('../components/ui',()=>({
 PrimaryButton:({children,onClick,disabled}:{children:ReactNode;onClick:()=>void;disabled?:boolean})=><button disabled={disabled} onClick={onClick}>{children}</button>,
 SecondaryButton:({children,onClick}:{children:ReactNode;onClick:()=>void})=><button onClick={onClick}>{children}</button>,
 ConfirmDialog:()=>null,
}));
afterEach(cleanup);
describe('locked browser passkey feedback',()=>{
 it('shows an incomplete ceremony as informational and does not automatically retry or erase',()=>{
  const unlock=vi.fn(),abandon=vi.fn();
  render(<UnlockPage isLoading={false} error={PASSKEY_INCOMPLETE_MESSAGE} onUnlock={unlock} onAbandon={abandon}/>);
  expect(screen.getByText('Wallet locked')).toBeVisible();
  expect(screen.getByText(PASSKEY_INCOMPLETE_MESSAGE)).toBeVisible();
  expect(screen.queryByText('Unlock failed')).toBeNull();
  expect(unlock).not.toHaveBeenCalled();expect(abandon).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Unlock with passkey'}));
  expect(unlock).toHaveBeenCalledTimes(1);expect(abandon).not.toHaveBeenCalled();
 });
 it('does not disguise a network failure as cancellation',()=>{
  render(<UnlockPage isLoading={false} error="Network problem. Check your connection and try again." onUnlock={vi.fn()} onAbandon={vi.fn()}/>);
  expect(screen.getByText('Unlock failed')).toBeVisible();
  expect(screen.queryByText(PASSKEY_INCOMPLETE_MESSAGE)).toBeNull();
 });
});
