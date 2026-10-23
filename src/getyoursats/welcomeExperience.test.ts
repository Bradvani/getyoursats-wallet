import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
describe('GetYourSats welcome experience',()=>{
 const home=readFileSync('src/pages/HomePage.tsx','utf8');
 const app=readFileSync('src/App.tsx','utf8');
 const css=readFileSync('src/getyoursats/branding.css','utf8');
 it('keeps one clearly primary Start button with real actions',()=>{
  expect(home).toContain('onClick={onCreateNewWallet}');
  expect(home).toContain('onClick={onRestoreWallet}');
  expect(home).toContain('onClick={onCreateManualWallet}');
 });
 it('does not show an intimidating technical release warning before user actions',()=>{
  expect(home).not.toContain('Secure one-tap web setup needs');
 });
 it('routes noncanonical preview onboarding to permanent RP rather than creating preview credentials',()=>{
  expect(app).toContain("window.location.hostname.endsWith('.vercel.app')");
  expect(app).toContain("window.location.assign('https://wallet.getyoursats.com')");
 });
 it('blends the official black-background mark instead of showing a square tile',()=>{
  expect(css).toContain('mix-blend-mode:screen');
  expect(home).toContain('/assets/getyoursats-mark.jpg');
 });
});
