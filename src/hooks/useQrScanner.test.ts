import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fullResolutionScanRegion, useQrScanner} from './useQrScanner';

const camera = vi.hoisted(() => ({
  getUserMedia:vi.fn(), stopTrack:vi.fn(), applyConstraints:vi.fn().mockResolvedValue(undefined), hasCamera: vi.fn(), listCameras: vi.fn(), start: vi.fn(),
  instances: [] as {stop: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; decode: (result: {data: string}) => void}[],
}));
vi.mock('@/utils/qrScanner', () => ({default: class {
  static hasCamera = camera.hasCamera;
  static listCameras = camera.listCameras;
  start = camera.start;
  stop = vi.fn();
  destroy = vi.fn();
  decode: (result: {data: string}) => void;
  constructor(_video: HTMLVideoElement, decode: (result: {data: string}) => void) {
    this.decode = decode;
    camera.instances.push(this);
  }
}}));
vi.mock('@/utils/haptics', () => ({hapticLight: vi.fn()}));

const media=()=>Object.assign(new MediaStream(),{getTracks:()=>[{stop:camera.stopTrack}],getVideoTracks:()=>[{stop:camera.stopTrack,getSettings:()=>({facingMode:'environment'}),getCapabilities:()=>({torch:true}),applyConstraints:camera.applyConstraints}]}) as unknown as MediaStream;
beforeEach(() => {
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:camera.getUserMedia}});
  Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:vi.fn().mockResolvedValue({state:'granted'})}});
  camera.getUserMedia.mockReset().mockImplementation(async()=>media());
  camera.stopTrack.mockClear();

  camera.instances.length = 0;
  camera.hasCamera.mockReset().mockResolvedValue(true);
  camera.listCameras.mockReset().mockResolvedValue([]);
  camera.start.mockReset().mockResolvedValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}

describe('fullResolutionScanRegion', () => {
  it('decodes the centered two-thirds square without shrinking it', () => {
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    expect(fullResolutionScanRegion(video)).toEqual({
      x: 600,
      y: 180,
      width: 720,
      height: 720,
      downScaledWidth: 720,
      downScaledHeight: 720,
    });
  });
});

describe('camera scan session', () => {
  it('does not start a camera after cancellation during camera discovery', async () => {
    const discovery = deferred<MediaStream>();
    camera.getUserMedia.mockReturnValue(discovery.promise);
    const {result} = renderHook(() => useQrScanner({onScan: vi.fn()}));
    result.current.videoRef.current = document.createElement('video');
    let starting!: Promise<void>;
    act(() => {starting = result.current.startScanning();});
    await waitFor(()=>expect(camera.getUserMedia).toHaveBeenCalledOnce());
    act(() => result.current.stopScanning());
    await act(async () => {discovery.resolve(media()); await starting;});
    expect(camera.stopTrack).toHaveBeenCalled();
    expect(camera.instances).toHaveLength(0);
    expect(result.current.isInitializing).toBe(false);
    expect(result.current.isScanning).toBe(false);
  });

  it('discards a camera start and decode that complete after cancellation', async () => {
    const start = deferred<void>();
    camera.start.mockReturnValue(start.promise);
    const onScan = vi.fn();
    const {result} = renderHook(() => useQrScanner({onScan}));
    result.current.videoRef.current = document.createElement('video');
    let starting!: Promise<void>;
    act(() => {starting = result.current.startScanning();});
    await waitFor(() => expect(camera.instances).toHaveLength(1));
    act(() => result.current.stopScanning());
    await act(async () => {start.resolve(); await starting;});
    act(() => camera.instances[0].decode({data: 'alice@example.invalid'}));
    expect(camera.instances[0].stop).toHaveBeenCalled();
    expect(camera.instances[0].destroy).toHaveBeenCalled();
    expect(onScan).not.toHaveBeenCalled();
    expect(result.current.isScanning).toBe(false);
    expect(result.current.isInitializing).toBe(false);
  });

  it('stops the camera before accepting one decoded result', async () => {
    const onScan = vi.fn(() => expect(camera.instances[0].destroy).toHaveBeenCalledOnce());
    const {result} = renderHook(() => useQrScanner({onScan}));
    result.current.videoRef.current = document.createElement('video');
    await act(async () => result.current.startScanning());
    act(() => {
      camera.instances[0].decode({data: 'alice@example.invalid'});
      camera.instances[0].decode({data: 'alice@example.invalid'});
    });
    expect(onScan).toHaveBeenCalledExactlyOnceWith('alice@example.invalid');
    expect(result.current.isScanning).toBe(false);
  });
});

it('makes only one camera request after denial, without a constraint retry loop',async()=>{
 camera.getUserMedia.mockRejectedValue(new DOMException('Denied','NotAllowedError'));
 const {result}=renderHook(()=>useQrScanner({onScan:vi.fn()}));result.current.videoRef.current=document.createElement('video');
 await act(()=>result.current.startScanning());
 expect(camera.getUserMedia).toHaveBeenCalledOnce();expect(result.current.error).toBe('denied');
});
it('reuses granted permission, exposes the torch and stops tracks when hidden',async()=>{
 const {result}=renderHook(()=>useQrScanner({onScan:vi.fn()}));result.current.videoRef.current=document.createElement('video');
 await act(()=>result.current.startScanning());expect(result.current.hasTorch).toBe(true);
 await act(()=>result.current.toggleTorch());expect(camera.applyConstraints).toHaveBeenCalledWith({advanced:[{torch:true}]});
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(result.current.isScanning).toBe(false);expect(camera.stopTrack).toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(camera.getUserMedia).toHaveBeenCalledOnce();
});
it('does not request again when browser permission is denied',async()=>{
 vi.mocked(navigator.permissions.query).mockResolvedValue({state:'denied'} as PermissionStatus);
 const {result}=renderHook(()=>useQrScanner({onScan:vi.fn()}));result.current.videoRef.current=document.createElement('video');
 await act(()=>result.current.startScanning());expect(camera.getUserMedia).not.toHaveBeenCalled();expect(result.current.error).toBe('denied');
});
