import { useEffect, useState } from 'react';
import { getAppVersion } from '@/services/appVersion';

/** Same native-shell or web-build version for Menu and Settings. */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(() => __APP_VERSION__);
  useEffect(() => {
    let mounted = true;
    void getAppVersion().then(value => { if (mounted) setVersion(value); });
    return () => { mounted = false; };
  }, []);
  return version;
}
