import React, { useState, type ReactNode } from 'react';
import { lazyRetry } from '../utils/importWithRetry';
import { isIframeDialerForced } from './dialerFlags';
import { SoftphoneContext, LOADING_VALUE, type SoftphoneContextValue } from './softphoneContext';

const DialerPanel = lazyRetry(() => import('../components/DialerPanel'));
const NativeDialerRuntime = lazyRetry(() => import('./NativeDialerRuntime'));

/**
 * Native softphone by default; `rmpg_dialer_iframe=1` restores the legacy iframe.
 *
 * Only this tiny shell is in the entry chunk: children render immediately under
 * an eager SoftphoneContext (placeholder value), and the lazily loaded runtime
 * mounts as a sibling and streams its live value up — so nothing under Layout
 * remounts when the softphone code arrives.
 */
export default function DialerMount({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SoftphoneContextValue>(LOADING_VALUE);
  if (isIframeDialerForced()) {
    return (
      <SoftphoneContext.Provider value={LOADING_VALUE}>
        {children}
        <React.Suspense fallback={null}><DialerPanel /></React.Suspense>
      </SoftphoneContext.Provider>
    );
  }
  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <React.Suspense fallback={null}><NativeDialerRuntime onValue={setValue} /></React.Suspense>
    </SoftphoneContext.Provider>
  );
}
