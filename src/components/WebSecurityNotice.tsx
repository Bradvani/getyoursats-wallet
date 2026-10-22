import React from 'react';
import {Capacitor} from '@capacitor/core';
import {AlertCard} from './AlertCard';

interface WebSecurityNoticeProps { recommendPasskey?:boolean }
export const WebSecurityNotice:React.FC<WebSecurityNoticeProps> = ({recommendPasskey=false})=>
 !Capacitor.isNativePlatform() ? <AlertCard variant="warning" title="Secure your wallet">
  <p className="text-spark-text-secondary text-sm">
   {recommendPasskey?'A passkey is recommended for safer web recovery. ':'A recovery phrase kept in browser storage can be exposed to browser extensions or compromised sites. '}
   Make sure you have a secure, recoverable backup before adding real funds.
  </p>
 </AlertCard> : null;
