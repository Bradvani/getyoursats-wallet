import { useCallback, useRef, useState } from 'react';
import QrScanner from '@/utils/qrScanner';
import { logger, LogCategory } from '@/services/logger';
import { formatError } from '@/utils/formatError';
import { hapticLight } from '@/utils/haptics';

export type FacingMode = 'environment' | 'user';

export interface UseQrScannerOptions {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
}

export interface UseQrScannerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  error: string | null;
  isScanning: boolean;
  isInitializing: boolean;
  facingMode: FacingMode;
  hasMultipleCameras: boolean;
  startScanning: () => Promise<void>;
  stopScanning: () => void;
  toggleCamera: () => void;
  clearError: () => void;
}

/** qr-scanner's default region (a centered square two thirds of the shorter
 *  side), decoded at full resolution. The default shrinks it to 400px, which
 *  leaves too few pixels per module to read a long bolt11 invoice. */
export function fullResolutionScanRegion(video: HTMLVideoElement): QrScanner.ScanRegion {
  const size = Math.round((2 / 3) * Math.min(video.videoWidth, video.videoHeight));
  return {
    x: Math.round((video.videoWidth - size) / 2),
    y: Math.round((video.videoHeight - size) / 2),
    width: size,
    height: size,
    downScaledWidth: size,
    downScaledHeight: size,
  };
}

/**
 * Hook to manage QR code scanning with camera controls
 * Encapsulates all scanner state and logic for reusability
 */
export const useQrScanner = ({ onScan, onError }: UseQrScannerOptions): UseQrScannerReturn => {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const qrScannerRef = useRef<QrScanner | null>(null);
  const scanSession = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stopScanning = useCallback(() => {
    scanSession.current += 1;
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      qrScannerRef.current.destroy();
      qrScannerRef.current = null;
    }
    setIsScanning(false);
    setIsInitializing(false);
  }, []);

  const startScanning = useCallback(async () => {
    const session = ++scanSession.current;
    try {
      setError(null);
      setIsInitializing(true);
      setIsScanning(false);

      if (!videoRef.current) {
        const errorMsg = 'Video element not available';
        setError(errorMsg);
        onError?.(errorMsg);
        setIsInitializing(false);
        return;
      }

      // Check if camera is available
      const hasCamera = await QrScanner.hasCamera();
      if (session !== scanSession.current) return;
      if (!hasCamera) {
        const errorMsg = 'No camera found on this device';
        setError(errorMsg);
        onError?.(errorMsg);
        setIsInitializing(false);
        return;
      }

      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (session !== scanSession.current) return;
          logger.debug(LogCategory.UI, 'QR code detected', {
            length: result.data.length,
          });
          void hapticLight();
          stopScanning();
          onScan(result.data);
        },
        {
          onDecodeError: (decodeError) => {
            // Ignore decode errors - they happen frequently while scanning
            logger.debug(LogCategory.UI, 'QR decode error', {
              error: formatError(decodeError),
            });
          },
          // Disable qr-scanner's built-in scan-region overlay: we draw our
          // own corner brackets in QrScannerDialog and having both visible
          // at once looks like a rendering bug (two overlapping squares).
          highlightScanRegion: false,
          highlightCodeOutline: false,
          calculateScanRegion: fullResolutionScanRegion,
          preferredCamera: facingMode,
          maxScansPerSecond: 5,
        }
      );

      qrScannerRef.current = scanner;
      await scanner.start();
      if (session !== scanSession.current) {
        scanner.stop();
        scanner.destroy();
        return;
      }
      logger.info(LogCategory.UI, 'QR scanner started successfully');
      setIsInitializing(false);
      setIsScanning(true);

      // Re-check cameras after permission is granted, since the initial
      // check may have returned stale results before the user allowed access
      try {
        const cameras = await QrScanner.listCameras(false);
        if (session !== scanSession.current) return;
        logger.debug(LogCategory.UI, 'Cameras after permission', {
          count: cameras.length,
        });
        const uniqueIds = new Set(cameras.map(c => c.id));
        setHasMultipleCameras(uniqueIds.size > 1);
      } catch (e) {
        logger.warn(LogCategory.UI, 'Failed to re-list cameras', {
          error: formatError(e),
        });
      }
    } catch (err) {
      if (session !== scanSession.current) return;
      logger.error(LogCategory.UI, 'Failed to start QR scanner', {
        error: formatError(err),
      });
      let errorMessage = 'Camera access denied or not available';

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Camera access denied. Please allow camera access and try again.';
        } else if (err.name === 'NotFoundError') {
          errorMessage = 'No camera found on this device';
        } else if (err.name === 'NotReadableError') {
          errorMessage = 'Camera is already in use by another application';
        } else if (err.name === 'OverconstrainedError') {
          errorMessage = 'Camera constraints not supported';
        }
      }

      setError(errorMessage);
      onError?.(errorMessage);
      setIsInitializing(false);
      setIsScanning(false);
    }
  }, [facingMode, onScan, onError, stopScanning]);

  const toggleCamera = useCallback(() => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    if (qrScannerRef.current) {
      qrScannerRef.current.setCamera(newMode).catch((err) => {
        logger.warn(LogCategory.UI, 'Failed to switch camera', {
          error: formatError(err),
        });
      });
    }
  }, [facingMode]);

  return {
    videoRef,
    error,
    isScanning,
    isInitializing,
    facingMode,
    hasMultipleCameras,
    startScanning,
    stopScanning,
    toggleCamera,
    clearError,
  };
};
