import React, { useEffect, useCallback, useRef, useState } from 'react';
import QrScanner from '@/utils/qrScanner';
import {useScannerPortrait} from '../hooks/useScannerPortrait';
import { BottomSheetContainer } from './ui';
import StartupLogo from './StartupLogo';
import '../getyoursats/scanner.css';
import { useQrScanner } from '../hooks/useQrScanner';
import { holdIdleLock } from '@/services/appLock';
import { CameraFlipIcon, ImageIcon, QrCodeIcon, CloseIcon, LightningBoltIcon } from './Icons';
import { useLatest } from '../hooks/useLatest';
import { usePresentation } from '../hooks/usePresentation';
import {PRODUCT_POLISH} from '../locales/productPolish';
import {SCANNER_TOOLS} from '../locales/scannerTools';
import { trustCopy } from '../getyoursats/trustCopy';

interface QrScannerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The owner advances the flow or closes the scanner after accepting a payload. */
  onScan: (data: string) => void;
  /** Raise it past a sheet it was opened from, which would otherwise cover it. */
  zIndex?: number;
}

const QrScannerDialog: React.FC<QrScannerDialogProps> = ({ isOpen, onClose, onScan, zIndex }) => {
  // Status / nav bar tints are handled by the shared BottomSheetContainer
  // since this dialog is mounted with fullHeight — isFullScreen is true
  // for the whole open lifetime, so both bars get the spark-surface push.

  const portraitStyle = useScannerPortrait(isOpen);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [isReadingImage, setIsReadingImage] = useState(false);
  const acceptedScan = useRef(false);
  const galleryRequest = useRef(0);
  const isOpenRef = useLatest(isOpen);
  const {language, copy: navigationCopy} = usePresentation();
  const copy=PRODUCT_POLISH[language];
  const toolsCopy=SCANNER_TOOLS[language];
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

  const handleScan = useCallback((data: string) => {
    if (!isOpenRef.current || acceptedScan.current) return;
    acceptedScan.current = true;
    galleryRequest.current += 1;
    setIsReadingImage(false);
    setGalleryError(null);
    onScan(data);
  }, [onScan, isOpenRef]);

  const {
    videoRef,
    error,
    isScanning,
    isInitializing,
    facingMode,
    hasMultipleCameras,
    startScanning,
    stopScanning,
    toggleCamera,
    clearError, hasTorch, torchOn, toggleTorch,
  } = useQrScanner({ onScan: handleScan });

  const handleGalleryPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || acceptedScan.current || !isOpenRef.current) return;
    const request = ++galleryRequest.current;
    setGalleryError(null);
    setIsReadingImage(true);
    try {
      const result = await QrScanner.scanImage(file);
      if (request !== galleryRequest.current || !isOpenRef.current) return;
      stopScanning();
      handleScan(result);
    } catch {
      if (request === galleryRequest.current && isOpenRef.current) {
        setGalleryError(copy.imageError);
      }
    } finally {
      if (request === galleryRequest.current) setIsReadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [handleScan, stopScanning, isOpenRef, copy.imageError]);

  // Aiming a camera produces no pointer or key events, so the idle
  // timer would run to completion mid-scan and lock the screen the
  // user is scanning with.
  useEffect(() => {
    if (!isOpen) return;
    return holdIdleLock();
  }, [isOpen]);

  // Use refs to avoid effect re-running when callbacks change
  const startScanningRef = useLatest(startScanning);
  const stopScanningRef = useLatest(stopScanning);

  useEffect(() => {
    // Capture the stop callback at effect start so cleanup invokes the
    // function that was current when the effect began, not whatever
    // happens to be in the ref at unmount time.
    const stop = stopScanningRef.current;
    galleryRequest.current += 1;
    if (isOpen) {
      acceptedScan.current = false;
      let frame=0;
      const openCamera=()=>{
        if(videoRef.current)void startScanningRef.current();
        else frame=requestAnimationFrame(openCamera);
      };
      frame=requestAnimationFrame(openCamera);
      return () => {
        cancelAnimationFrame(frame);
        galleryRequest.current += 1;
        acceptedScan.current = true;
        stop();
      };
    } else {
      stop();
    }
  }, [isOpen, videoRef, startScanningRef, stopScanningRef]);

  const handleClose = () => {
    acceptedScan.current = true;
    galleryRequest.current += 1;
    setIsReadingImage(false);
    setGalleryError(null);
    stopScanning();
    clearError();
    onClose();
  };

  const cameraUnavailable = !isScanning && !isInitializing && !!error;
  const status = isReadingImage ? trustCopy(language).checking
    : cameraUnavailable ? copy.unavailable : isInitializing || !isScanning ? copy.starting : copy.point;

  return (
    <BottomSheetContainer isOpen={isOpen} onClose={handleClose} fullHeight maxWidth="full" zIndex={zIndex}>
      <div className="gys-scanner-portrait" data-testid="scanner-portrait"
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        style={{
          paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
          paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))',
          ...portraitStyle,
        }}>
        <header className="gys-scanner-header">
          <div className="gys-scanner-identity">
            <StartupLogo className="gys-scanner-logo" />
            <h2>{navigationCopy.scan}</h2>
          </div>
          <button type="button" className="gys-scanner-close" onClick={handleClose} aria-label={copy.cancel}>
            <CloseIcon size="lg" />
          </button>
        </header>

        <div className="gys-scanner-stage">
          {/* Keep the square feed and middle-two-thirds target aligned with
              the decoder. Branding and controls never cover this region. */}
          <div className="gys-scanner-camera">
            <video ref={videoRef} className="gys-scanner-video" playsInline muted autoPlay
              poster="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%230B0B0B'/%3E%3C/svg%3E"
              style={{transform: facingMode === 'user' ? 'scaleX(-1)' : undefined}} />
            <div className="gys-scanner-target" aria-hidden="true">
              <i /><i /><i /><i />
              {isScanning && !isReadingImage && <span className="gys-scanner-sweep" />}
            </div>
            {(isInitializing || isReadingImage || cameraUnavailable) &&
              <div className="gys-scanner-placeholder" aria-hidden="true">
                {isInitializing || isReadingImage
                  ? <span className="gys-scanner-spinner" />
                  : <QrCodeIcon size="xl" />}
              </div>}
          </div>
        </div>

        <div className="gys-scanner-footer">
          <div className="gys-scanner-status" role="status" aria-live="polite">
            <span className="gys-scanner-status-dot" data-ready={isScanning && !isReadingImage} aria-hidden="true" />
            <p>{status}</p>
          </div>
          {cameraUnavailable && <div className="gys-scanner-message">
            <p>{error === 'denied' ? copy.denied : error === 'busy' ? copy.busy : ''}</p>
            <button type="button" className="gys-scanner-retry" onClick={() => void startScanning()} disabled={isReadingImage}>{copy.retry}</button>
          </div>}
          {galleryError && <p className="gys-scanner-error" role="alert">{galleryError}</p>}
          <div className="gys-scanner-actions">
            <button type="button" className="gys-scanner-action gys-scanner-gallery"
              onClick={() => fileInputRef.current?.click()} disabled={isReadingImage} aria-label={copy.gallery}>
              <ImageIcon size="lg" /><span>{toolsCopy.gallery}</span>
            </button>
            {hasTorch && <button type="button" className="gys-scanner-action"
              onClick={() => void toggleTorch()} disabled={isReadingImage} aria-pressed={torchOn} aria-label={torchOn ? copy.torchOff : copy.torchOn}>
              <LightningBoltIcon size="lg" /><span>{toolsCopy.light}</span>
            </button>}
            {hasMultipleCameras && <button type="button" className="gys-scanner-action"
              onClick={toggleCamera} disabled={isReadingImage} aria-label={copy.flip}>
              <CameraFlipIcon size="lg" /><span>{toolsCopy.flip}</span>
            </button>}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleGalleryPick} />
          {isiOS && cameraUnavailable && <details className="gys-scanner-help">
            <summary>{copy.access}</summary><p>{copy.iosHelp}</p>
          </details>}
        </div>
      </div>
    </BottomSheetContainer>
  );
};

export default QrScannerDialog;
