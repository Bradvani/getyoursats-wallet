import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import PaymentPushSetting from './PaymentPushSetting';

const mocks=vi.hoisted(()=>({
  sdk:{getInfo:vi.fn(),registerWebhook:vi.fn()},signed:vi.fn(),network:vi.fn(),
}));
vi.mock('../contexts/WalletContext',()=>({useWallet:()=>mocks.sdk}));
vi.mock('../services/sdkConnect',()=>({selectedNetwork:()=>mocks.network()}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}));
vi.mock('../services/paymentPush',async importOriginal=>({
  ...await importOriginal<typeof import('../services/paymentPush')>(),signedPushOperation:mocks.signed,
}));
const pub='02'+'ab'.repeat(32),endpoint='https://web.push.apple.com/test-device-123456';
const key=Uint8Array.from({length:65},(_,index)=>index===0?4:1);
const config={available:true,vapidPublicKey:btoa(String.fromCharCode(...key)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),
  lightningInvoicePushAvailable:true,lightningAddressPushAvailable:true};
let subscription:{endpoint:string;options:{applicationServerKey:ArrayBuffer};unsubscribe:ReturnType<typeof vi.fn>;toJSON:ReturnType<typeof vi.fn>};
beforeEach(()=>{
  vi.clearAllMocks();mocks.network.mockReturnValue('mainnet');
  mocks.sdk.getInfo.mockResolvedValue({identityPubkey:pub});
  mocks.sdk.registerWebhook.mockRejectedValue(new Error('Invoice provider unavailable'));
  mocks.signed.mockImplementation(async(_sdk,_pub,action,extra)=>{
    if(action==='status')return {enabled:false,webhookRegistered:false};
    if(action==='subscribe')return {webhookRegistered:false,
      webhookUrl:'https://wallet.getyoursats.com/api/notifications/spark?wallet='+pub,webhookSecret:'ab'.repeat(32)};
    return {enabled:action==='activate',webhookRegistered:action==='activate'&&!!extra.webhookId};
  });
  subscription={endpoint,options:{applicationServerKey:key.buffer},unsubscribe:vi.fn().mockResolvedValue(true),
    toJSON:vi.fn().mockReturnValue({endpoint,keys:{p256dh:'test-key',auth:'test-auth'}})};
  const registration={pushManager:{getSubscription:vi.fn().mockResolvedValue(subscription),subscribe:vi.fn().mockResolvedValue(subscription)}};
  vi.stubGlobal('isSecureContext',true);vi.stubGlobal('PushManager',class {});
  vi.stubGlobal('Notification',{permission:'granted',requestPermission:vi.fn().mockResolvedValue('granted')});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
    getRegistration:vi.fn().mockResolvedValue(registration),register:vi.fn().mockResolvedValue(registration),
  }});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(config)));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});

it('checks actual server consent rather than trusting an old local enabled preference',async()=>{
  localStorage.setItem('gys:push:active-wallet:v1:'+pub,'true');
  const {container}=render(<PaymentPushSetting/>);
  await waitFor(()=>expect(mocks.signed).toHaveBeenCalledWith(mocks.sdk,pub,'status',{endpoint},expect.any(Function)));
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');
  expect(container).not.toHaveTextContent(/breez|spark|webhook/i);
  expect(screen.queryByText(/payments only/)).not.toBeInTheDocument();
});

it('enables domain alerts when independent invoice registration fails and states that limit',async()=>{
  render(<PaymentPushSetting/>);
  await waitFor(()=>expect(screen.getByRole('switch')).toBeEnabled());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(()=>expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true'));
  expect(screen.getByText('@getyoursats.com payments only.')).toBeVisible();
  expect(mocks.signed).toHaveBeenCalledWith(mocks.sdk,pub,'activate',{endpoint,webhookId:''},expect.any(Function));
});

it.each(['U3BhcmtXYWxsZXRWZWJob29rOjEyMzQ=', 'SparkWalletWebhook:ab/cd+ef=='])(
'activates invoice alerts with the exact opaque SDK identifier %s',async webhookId=>{
  mocks.sdk.registerWebhook.mockResolvedValue({webhookId});
  render(<PaymentPushSetting/>);
  await waitFor(()=>expect(screen.getByRole('switch')).toBeEnabled());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(()=>expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true'));
  expect(mocks.signed).toHaveBeenCalledWith(mocks.sdk,pub,'activate',{endpoint,webhookId},expect.any(Function));
  expect(screen.getByText('Lightning invoices and @getyoursats.com payments.')).toBeVisible();
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it('keeps address alerts available when the SDK returns a malformed identifier',async()=>{
  mocks.sdk.registerWebhook.mockResolvedValue({webhookId:'invalid\nidentifier'});
  render(<PaymentPushSetting/>);
  await waitFor(()=>expect(screen.getByRole('switch')).toBeEnabled());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(()=>expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true'));
  expect(mocks.signed).toHaveBeenCalledWith(mocks.sdk,pub,'activate',{endpoint,webhookId:''},expect.any(Function));
  expect(screen.getByText('@getyoursats.com payments only.')).toBeVisible();
});

it('shows an actionable setup error without exposing provider internals',async()=>{
  vi.mocked(fetch).mockResolvedValue(Response.json({...config,lightningAddressPushAvailable:false}));
  mocks.sdk.registerWebhook.mockRejectedValue(new Error('Invalid provider webhook identifier'));
  const {container}=render(<PaymentPushSetting/>);
  await waitFor(()=>expect(screen.getByRole('switch')).toBeEnabled());
  fireEvent.click(screen.getByRole('switch'));
  expect(await screen.findByText('Could not update alerts. Please try again.')).toBeVisible();
  expect(container).not.toHaveTextContent(/provider|webhook/i);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');
  expect(subscription.unsubscribe).toHaveBeenCalled();
});

it('makes no notification enrollment requests on a non-mainnet wallet',()=>{
  mocks.network.mockReturnValue('regtest');render(<PaymentPushSetting/>);
  expect(screen.getByText('Payment alerts are available on mainnet.')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();expect(mocks.signed).not.toHaveBeenCalled();
});
