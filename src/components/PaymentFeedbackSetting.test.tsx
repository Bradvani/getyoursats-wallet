import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import PaymentFeedbackSetting from './PaymentFeedbackSetting';
import {paymentHapticsEnabled} from '../utils/transferHaptics';
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>false}}));
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
it('persists the vibration preference without emitting a sample payment vibration',()=>{
 const vibrate=vi.fn();Object.defineProperty(navigator,'vibrate',{configurable:true,value:vibrate});
 const {unmount}=render(<PaymentFeedbackSetting/>);
 fireEvent.click(screen.getByRole('switch',{name:'Payment vibration'}));
 expect(paymentHapticsEnabled()).toBe(false);
 expect(vibrate).not.toHaveBeenCalled();
 expect(screen.queryByRole('button',{name:/test|preview/i})).toBeNull();
 unmount();render(<PaymentFeedbackSetting/>);
 expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','false');
});
it('omits the control on devices without vibration support',()=>{
 Object.defineProperty(navigator,'vibrate',{configurable:true,value:undefined});
 const {container}=render(<PaymentFeedbackSetting/>);expect(container).toBeEmptyDOMElement();
});
