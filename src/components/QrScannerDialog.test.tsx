import type {ReactNode} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import QrScannerDialog from './QrScannerDialog';

const scanner = vi.hoisted(() => ({
  onScan: null as null | ((data: string) => void),
  videoRef: {current: null as HTMLVideoElement | null},
  scanImage: vi.fn(), stop: vi.fn(), start: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/utils/qrScanner', () => ({default: {scanImage: scanner.scanImage}}));
vi.mock('../hooks/useQrScanner', () => ({useQrScanner: ({onScan}: {onScan: (data: string) => void}) => {
  scanner.onScan = onScan;
  return {videoRef: scanner.videoRef, error: null, isScanning: true, isInitializing: false,
    facingMode: 'environment', hasMultipleCameras: false, startScanning: scanner.start,
    stopScanning: scanner.stop, toggleCamera: vi.fn(), clearError: scanner.clear};
}}));
vi.mock('./ui', () => ({
  BottomSheetContainer: ({isOpen, children}: {isOpen: boolean; children: ReactNode}) => isOpen ? <div role="dialog">{children}</div> : null,
  FloatingIconButton: ({icon: _icon, ...props}: {icon: ReactNode}) => <button {...props}/>,
}));
vi.mock('@/services/appLock', () => ({holdIdleLock: () => () => {}}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

function setup() {
  const onScan = vi.fn(), onClose = vi.fn();
  const view = render(<QrScannerDialog isOpen onScan={onScan} onClose={onClose}/>);
  const chooseImage = () => fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: {files: [new File(['synthetic image'], 'address.png', {type: 'image/png'})]},
  });
  return {...view, onScan, onClose, chooseImage};
}

beforeEach(() => {
  vi.clearAllMocks();
  scanner.scanImage.mockReset();
});

describe('QR acceptance and cancellation', () => {
  it('accepts a camera result once without also invoking cancellation', () => {
    const view = setup();
    act(() => {scanner.onScan?.('alice@example.invalid'); scanner.onScan?.('alice@example.invalid');});
    expect(view.onScan).toHaveBeenCalledExactlyOnceWith('alice@example.invalid');
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it('accepts a gallery result without closing through the cancellation handler', async () => {
    scanner.scanImage.mockResolvedValue('alice@example.invalid');
    const view = setup();
    view.chooseImage();
    await waitFor(() => expect(view.onScan).toHaveBeenCalledExactlyOnceWith('alice@example.invalid'));
    expect(scanner.stop).toHaveBeenCalledOnce();
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it('discards a gallery decode that finishes after Cancel', async () => {
    const image = deferred<string>();
    scanner.scanImage.mockReturnValue(image.promise);
    const view = setup();
    view.chooseImage();
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    await act(async () => image.resolve('alice@example.invalid'));
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.onScan).not.toHaveBeenCalled();
  });

  it('discards a gallery decode after the scanner unmounts', async () => {
    const image = deferred<string>();
    scanner.scanImage.mockReturnValue(image.promise);
    const view = setup();
    view.chooseImage();
    view.unmount();
    await act(async () => image.resolve('alice@example.invalid'));
    expect(view.onScan).not.toHaveBeenCalled();
  });

  it('keeps an unreadable image in the scanner with a retryable error', async () => {
    scanner.scanImage.mockRejectedValue(new Error('No code'));
    const view = setup();
    view.chooseImage();
    expect(await screen.findByText('No QR code found in image. Try another image or use the camera.')).toBeVisible();
    expect(view.onScan).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: 'Pick image from gallery'})).toBeEnabled();
  });

  it('allows the same payload again in a new scanner session', () => {
    const view = setup();
    act(() => scanner.onScan?.('alice@example.invalid'));
    view.rerender(<QrScannerDialog isOpen={false} onScan={view.onScan} onClose={view.onClose}/>);
    view.rerender(<QrScannerDialog isOpen onScan={view.onScan} onClose={view.onClose}/>);
    act(() => scanner.onScan?.('alice@example.invalid'));
    expect(view.onScan).toHaveBeenCalledTimes(2);
    expect(view.onClose).not.toHaveBeenCalled();
  });
});
