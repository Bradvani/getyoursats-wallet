import {act, renderHook, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fullResolutionScanRegion, useQrScanner} from './useQrScanner';

const camera = vi.hoisted(() => ({
  hasCamera: vi.fn(), listCameras: vi.fn(), start: vi.fn(),
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

beforeEach(() => {
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
    const discovery = deferred<boolean>();
    camera.hasCamera.mockReturnValue(discovery.promise);
    const {result} = renderHook(() => useQrScanner({onScan: vi.fn()}));
    result.current.videoRef.current = document.createElement('video');
    let starting!: Promise<void>;
    act(() => {starting = result.current.startScanning();});
    act(() => result.current.stopScanning());
    await act(async () => {discovery.resolve(true); await starting;});
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
