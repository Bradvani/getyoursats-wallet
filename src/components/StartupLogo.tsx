import { usePresentation } from '@/hooks/usePresentation';

/** Theme-aware artwork without changing the launch screens' existing dimensions. */
export default function StartupLogo({ className }: { className: string }) {
  const { resolved } = usePresentation();
  return <img src={`/brand/wordmark-stacked-${resolved === 'orange' ? 'light' : 'dark'}.svg`}
    alt="GetYourSats" className={className} />;
}
