import {useFlowText} from '@/hooks/useFlowText';
import React, { ReactNode } from 'react';
import { BackIcon } from '../Icons';
import { safeAreaTop, safeAreaBottom } from '../../utils/safeAreaInsets';
import { useStatusBarColor } from '../../hooks/useStatusBarColor';
import { STATUS_BAR_SURFACE } from '../../utils/statusBarManager';

interface PageLayoutProps {
  children: ReactNode;
  footer: ReactNode
  onBack: () => void | null;
  title?: string;
  showHeader?: boolean;
  onClearError?: () => void;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  title,
  footer,
  onBack = null,
  showHeader = true,
}) => {
  // Generic PageLayout screens (get refund, etc.) use a solid
  // spark-surface background; match the system bars to that tone.
  useStatusBarColor(STATUS_BAR_SURFACE);
  const t=useFlowText();

  return (
    <div className="gys-page-surface min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      {showHeader && (
        <header
          className="relative z-10 shrink-0 border-b border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingTop: safeAreaTop }}
        >
          {/* The title can wrap without overlapping the back control. */}
          <div className={`gys-page-toolbar ${onBack?'gys-page-toolbar--back':''}`}>
            {onBack&&<button type="button" onClick={onBack} className="gys-page-toolbar__action" aria-label={t('Back')}>
              <BackIcon className="rtl:rotate-180"/>
            </button>}
            <h1>{title||'GetYourSats'}</h1>
          </div>
        </header>
      )}

      {/* Scrollable content area */}
      <main 
        className="relative z-10 flex-1 w-full overflow-y-auto p-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {children}
      </main>

      {/* Fixed footer */}
      {footer && (
        <footer
          className="relative z-10 shrink-0 w-full border-t border-spark-border bg-spark-surface/80 backdrop-blur-sm"
          style={{ paddingBottom: safeAreaBottom }}
        >
          <div className="px-4 py-4">
            {footer}
          </div>
        </footer>
      )}
    </div>
  );
};

export default PageLayout;
