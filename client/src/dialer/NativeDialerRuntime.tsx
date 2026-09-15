import { useEffect } from 'react';
import { SoftphoneProvider, useSoftphone } from './SoftphoneProvider';
import type { SoftphoneContextValue } from './softphoneContext';
import IncomingCallToast from './IncomingCallToast';
import DuressBanner from './DuressBanner';

// Lazily loaded by DialerMount so the Twilio softphone glue stays out of the
// SPA entry chunk. It renders nothing of its own except the global toasts and
// hands its live context value up to the outer (eager) SoftphoneContext
// provider that the rest of the app reads.
function ValueBridge({ onValue }: { onValue(v: SoftphoneContextValue): void }) {
  const value = useSoftphone();
  useEffect(() => { onValue(value); }, [value, onValue]);
  return null;
}

export default function NativeDialerRuntime({ onValue }: { onValue(v: SoftphoneContextValue): void }) {
  return (
    <SoftphoneProvider>
      <ValueBridge onValue={onValue} />
      <IncomingCallToast />
      <DuressBanner />
    </SoftphoneProvider>
  );
}
