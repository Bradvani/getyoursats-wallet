type Props = {
  compact?: boolean;
  landing?: boolean;
};

/**
 * A consistent GetYourSats identity in every header. Purely presentational:
 * never starts, restores, switches or modifies an existing wallet.
 */
export default function GetYourSatsWordmark({compact = false,landing = false}:Props) {
  return (
    <span className={`gys-wordmark ${compact?'gys-wordmark--compact':''} ${landing?'gys-wordmark--landing':''}`}
      aria-label="GetYourSats">
      <img className="gys-wordmark__mark" src="/assets/getyoursats-mark.jpg" width={32} height={32} alt="" />
      <span className="gys-wordmark__name">GetYourSats</span>
    </span>
  );
}
