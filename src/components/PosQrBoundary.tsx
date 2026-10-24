import React from 'react';
import {logger,LogCategory} from '../services/logger';

interface Props {children:React.ReactNode}
interface State {failed:boolean}

/** A malformed/oversized QR cannot crash the wallet or hide the copyable invoice.
 * This boundary does not verify whether an invoice has settled. */
export default class PosQrBoundary extends React.Component<Props,State>{
  state:State={failed:false};
  static getDerivedStateFromError():State{return {failed:true}}
  componentDidCatch(error:Error, info:React.ErrorInfo){
    logger.error(LogCategory.UI,'Merchant invoice QR render failed',{
      error:error.message,componentStack:info.componentStack??undefined,
    });
  }
  render(){
    if(!this.state.failed)return this.props.children;
    return <p role="status" className="gys-pos-terminal__muted">
      The invoice was created but its QR code could not be displayed.
      Use Copy invoice or the verified wallet history; do not create a second charge without checking.
    </p>;
  }
}
