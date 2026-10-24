import React from 'react';
import {logger,LogCategory} from '../services/logger';

interface Props {children:React.ReactNode;onClose:()=>void}
interface State {failed:boolean}

/** Isolate a faulty POS invoice/QR render from the seed-backed wallet shell.
 * Never reset local wallet data or imply a generated invoice was unpaid. */
export default class PosErrorBoundary extends React.Component<Props,State>{
  state:State={failed:false};
  static getDerivedStateFromError():State{return {failed:true}}
  componentDidCatch(error:Error,info:React.ErrorInfo){
    logger.error(LogCategory.UI,'Merchant POS render failure',{
      error:error.message,componentStack:info.componentStack??undefined,
    });
  }
  render(){
    if(!this.state.failed)return this.props.children;
    return <div role="dialog" aria-modal="true" aria-label="Point of Sale unavailable"
      className="gys-pos gys-pos--terminal">
      <div className="gys-pos-terminal" style={{padding:24}}>
        <h2>Point of Sale interrupted</h2>
        <p role="alert">We couldn't display this checkout. An invoice may already have been requested.
          Check verified wallet activity before attempting another charge.</p>
        <button type="button" className="gys-pos-terminal__charge" onClick={this.props.onClose}>
          Return to wallet
        </button>
      </div>
    </div>;
  }
}
