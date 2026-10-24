import { usePresentation } from '@/hooks/usePresentation';
type Props = { compact?: boolean; landing?: boolean };
/** Outlined artwork: no device font substitution or legacy media symbol. */
export default function GetYourSatsWordmark({ compact = false, landing = false }: Props) {
  const { resolved } = usePresentation();
  const tone = resolved === 'orange' ? 'light' : 'dark';
  return <img className={`gys-brand-wordmark ${compact ? 'gys-brand-wordmark--compact' : ''} ${landing ? 'gys-brand-wordmark--landing' : ''}`}
    src={compact ? `/brand/wordmark-horizontal-${tone}.svg` : `/brand/wordmark-stacked-${tone}.svg`}
    width={compact ? 160 : 140} height={compact ? 34 : 82} alt="GetYourSats" />;
}
