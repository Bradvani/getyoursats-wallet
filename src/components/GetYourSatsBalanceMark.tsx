import {TransferBrandMark} from './Icons';

export default function GetYourSatsBalanceMark() {
  return <span className="gys-balance-mark" data-testid="sats-balance-mark" aria-hidden="true">
    <TransferBrandMark direction="sent" animate={false} fillFraction={0}/>
  </span>;
}
