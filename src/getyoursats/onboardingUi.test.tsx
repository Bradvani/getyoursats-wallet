import type {ReactNode,ButtonHTMLAttributes} from 'react';
import {describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import GeneratePage from '../pages/GeneratePage';
import RestorePage from '../pages/RestorePage';

vi.mock('bip39',async(importOriginal)=>{
 const original=await importOriginal<typeof import('bip39')>();
 return {...original,generateMnemonic:()=>Array(11).fill('abandon').concat('about').join(' ')};
});
vi.mock('../components/layout/PageLayout',()=>({
 default:({children,footer}:{children:ReactNode;footer:ReactNode})=>
  <main>{children}<footer>{footer}</footer></main>
}));
vi.mock('../components/ui',()=>({
 PrimaryButton:(props:ButtonHTMLAttributes<HTMLButtonElement>)=><button {...props}/>,
 FIELD_BASE_CLASS:'test-field',
}));
vi.mock('../components/AlertCard',()=>({
 AlertCard:({children}:{children:ReactNode})=><div>{children}</div>,
 SimpleAlert:({children}:{children:ReactNode})=><div>{children}</div>,
}));
vi.mock('../components/WebSecurityNotice',()=>({WebSecurityNotice:()=>null}));
vi.mock('../utils/screenSecurity',()=>({useScreenCaptureProtection:()=>undefined}));

describe('privacy-first recovery screens',()=>{
 it('hides generated words until the two privacy checks and explicit eye toggle',async()=>{
  render(<GeneratePage onMnemonicConfirmed={vi.fn()} onBack={vi.fn()}
   onClearError={vi.fn()} error={null}/>);
  await waitFor(()=>expect(screen.getByRole('status',{name:''}).textContent).toContain('Recovery words hidden'));
  expect(screen.queryByText('abandon')).toBeNull();
  const reveal=screen.getByRole('button',{name:'Reveal recovery words'}) as HTMLButtonElement;
  expect(reveal.disabled).toBe(true);
  const checkboxes=screen.getAllByRole('checkbox') as HTMLInputElement[];
  expect(checkboxes).toHaveLength(3);
  fireEvent.click(checkboxes[0]);fireEvent.click(checkboxes[1]);
  expect(reveal.disabled).toBe(false);
  fireEvent.click(reveal);
  expect(screen.getAllByText('abandon')).toHaveLength(11);
  fireEvent.click(screen.getByRole('button',{name:'Hide recovery words'}));
  expect(screen.queryByText('abandon')).toBeNull();
  const next=screen.getByRole('button',{name:'Verify my handwritten backup'}) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  fireEvent.click(checkboxes[2]);
  expect(next.disabled).toBe(false);
 });
 it('restores with an existing passkey before exposing manual phrase input',()=>{
  const onUsePasskey=vi.fn();
  render(<RestorePage onUsePasskey={onUsePasskey} onConnect={vi.fn()} onBack={vi.fn()}
    onClearError={vi.fn()}/>);
  expect(screen.queryByTestId('mnemonic-input')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Sign in with my passkey'}));
  expect(onUsePasskey).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'Restore with handwritten recovery words'}));
  expect(screen.getByTestId('mnemonic-input')).toBeTruthy();
 });
});
