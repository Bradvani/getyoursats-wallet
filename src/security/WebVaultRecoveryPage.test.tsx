import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import WebVaultRecoveryPage from './WebVaultRecoveryPage';

vi.mock('../hooks/usePresentation',()=>({usePresentation:()=>({language:'en'})}));
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
afterEach(()=>{if(visibility)Object.defineProperty(document,'visibilityState',visibility);else Reflect.deleteProperty(document,'visibilityState')});
function fill(){
 fireEvent.change(screen.getByLabelText('Recovery words'),{target:{value:words}});
 fireEvent.change(screen.getByLabelText('New wallet password'),{target:{value:'replacement-password-12345'}});
 fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'replacement-password-12345'}});
}
describe('protected wallet recovery UI',()=>{
 it('allows only one submission while encryption is pending',async()=>{
  let done!:()=>void;const onSubmit=vi.fn(()=>new Promise<void>(resolve=>{done=resolve}));
  render(<WebVaultRecoveryPage onSubmit={onSubmit} onBack={()=>{}} busy={false}/>);fill();
  fireEvent.click(screen.getByRole('button',{name:'Restore protection'}));
  fireEvent.submit(screen.getByLabelText('Recovery words').closest('form')!);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await act(async()=>done());
  expect(screen.getByLabelText('Recovery words')).toHaveValue('');
  expect(screen.getByLabelText('New wallet password')).toHaveValue('');
 });
 it('clears recovery words and passwords when the page backgrounds',()=>{
  render(<WebVaultRecoveryPage onSubmit={async()=>{}} onBack={()=>{}} busy={false}/>);fill();
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByLabelText('Recovery words')).toHaveValue('');
  expect(screen.getByLabelText('New wallet password')).toHaveValue('');
  expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
 });
 it('explains a separate-device recovery route without erasing the original data',()=>{
  render(<WebVaultRecoveryPage onSubmit={async()=>{}} onBack={()=>{}} busy={false}/>);
  expect(screen.getByText(/Do not remove the wallet or clear site data/)).toBeInTheDocument();
  expect(screen.getByText(/another trusted device or in a separate browser profile/)).toBeInTheDocument();
 });
});
