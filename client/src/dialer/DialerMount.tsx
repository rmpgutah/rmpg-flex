import React, { type ReactNode } from 'react';
import { lazyRetry } from '../utils/importWithRetry';
import { isIframeDialerForced } from './dialerFlags';
import { SoftphoneProvider } from './SoftphoneProvider';
import IncomingCallToast from './IncomingCallToast';
import DuressBanner from './DuressBanner';

const DialerPanel = lazyRetry(() => import('../components/DialerPanel'));

/** Native softphone by default; `rmpg_dialer_iframe=1` restores the legacy iframe. */
export default function DialerMount({ children }: { children: ReactNode }) {
  if (isIframeDialerForced()) {
    return (
      <>
        {children}
        <React.Suspense fallback={null}><DialerPanel /></React.Suspense>
      </>
    );
  }
  return (
    <SoftphoneProvider>
      {children}
      <IncomingCallToast />
      <DuressBanner />
    </SoftphoneProvider>
  );
}
