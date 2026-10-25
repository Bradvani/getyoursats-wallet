import React, { ReactNode, useEffect } from 'react';
import { usePlatform } from '../../hooks/usePlatform';

interface AppShellProps {
  children: ReactNode;
}

/**
 * AppShell - Applies safe area padding via CSS env() variables.
 * Top/left/right insets are handled here; bottom inset is handled
 * by individual components (e.g. bottom-bar, SideMenu).
 */
const AppShell: React.FC<AppShellProps> = ({ children }) => {
  useEffect(() => {
    const sync = () => document.documentElement.toggleAttribute('data-ui-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      document.documentElement.removeAttribute('data-ui-hidden');
    };
  }, []);
  const { isStandalone, isIOS, isAndroid } = usePlatform();

  return (
    <div className='main-wrapper'>
      <div id="content-root" className='max-w-4xl mx-auto'>
        <div className="app-shell" data-pwa={isStandalone} data-ios={isIOS} data-android={isAndroid}>
          <div className='page-layout'>{children}</div>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
