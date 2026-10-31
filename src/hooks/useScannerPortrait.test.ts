import {describe,it,expect,vi,afterEach} from 'vitest';
import {renderHook,waitFor} from '@testing-library/react';
import {scannerPortraitFrame,useScannerPortrait} from './useScannerPortrait';
afterEach(()=>vi.unstubAllGlobals());
describe('phone scanner portrait geometry',()=>{
  it('keeps both landscape directions in the original portrait frame',()=>{
    expect(scannerPortraitFrame(844,390,90,true)).toEqual({width:390,height:844,angle:-90});
    expect(scannerPortraitFrame(844,390,-90,true)).toEqual({width:390,height:844,angle:90});
    expect(scannerPortraitFrame(844,390,270,true)).toEqual({width:390,height:844,angle:90});
  });
  it('does not rotate portrait phones, desktop windows or devices without orientation evidence',()=>{
    expect(scannerPortraitFrame(390,844,0,true).angle).toBe(0);
    expect(scannerPortraitFrame(1200,800,90,false).angle).toBe(0);
    expect(scannerPortraitFrame(844,390,0,true).angle).toBe(0);
  });
  it('releases a successful late lock after the scanner was closed',async()=>{
    let resolve:()=>void=()=>{};const unlock=vi.fn();const lock=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
    vi.stubGlobal('screen',{width:390,height:844,orientation:{angle:0,lock,unlock,addEventListener:vi.fn(),removeEventListener:vi.fn()}});
    vi.stubGlobal('matchMedia',()=>({matches:true}));
    const {unmount}=renderHook(()=>useScannerPortrait(true));
    expect(lock).toHaveBeenCalledWith('portrait-primary');unmount();resolve();
    await waitFor(()=>expect(unlock).toHaveBeenCalledOnce());
  });
});
