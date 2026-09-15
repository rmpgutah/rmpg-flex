import React, { useState, type ReactNode } from 'react';
import { lazyRetry } from '../utils/importWithRetry';
import { SoftphoneContext, LOADING_VALUE, type SoftphoneContextValue } from './softphoneContext';

const NativeDialerRuntime = lazyRetry(() => import('./NativeDialerRuntime'));

/**
 * Mounts the native softphone. The legacy Dial Connect iframe panel and its
 * `rmpg_dialer_iframe` kill-switch were removed in P6 — this is now the only
 * telephony runtime.
 *
 * Only this tiny shell is in the entry chunk: children render immediately under
 * an eager SoftphoneContext (placeholder value), and the lazily loaded runtime
 * mounts as a sibling and streams its live value up — so nothing under Layout
 * remounts when the softphone code arrives.
 */
export default function DialerMount({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SoftphoneContextValue>(LOADING_VALUE);
  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <React.Suspense fallback={null}><NativeDialerRuntime onValue={setValue} /></React.Suspense>
    </SoftphoneContext.Provider>
  );
}
