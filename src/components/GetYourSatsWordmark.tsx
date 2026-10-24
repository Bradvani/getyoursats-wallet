type Props = { compact?: boolean; landing?: boolean };
/** Outlined artwork: no device font substitution or legacy media symbol. */
export default function GetYourSatsWordmark({ compact = false, landing = false }: Props) {
  return <img className={`gys-brand-wordmark ${compact ? 'gys-brand-wordmark--compact' : ''} ${landing ? 'gys-brand-wordmark--landing' : ''}`}
    src="/brand/wordmark-stacked-dark.svg" width={140} height={82} alt="GetYourSats" />;
}
