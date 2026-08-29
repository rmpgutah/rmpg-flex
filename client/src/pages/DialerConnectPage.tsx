import { useEffect } from 'react';
import { DIALER_HOST_ID } from '../components/dialerConnect';

/**
 * Dispatch-shell host for Dial Connect. The live iframe is owned by
 * `DialerPanel` (mounted once on Layout) so Twilio Voice stays registered
 * across CAD navigation. This page only provides the dock the iframe
 * positions into.
 */
export default function DialerConnectPage() {
  useEffect(() => {
    document.title = 'Dialer Connect — RMPG Flex';
  }, []);

  return (
    <div
      id={DIALER_HOST_ID}
      data-testid="dialer-connect-host"
      className="relative w-full h-full min-h-0"
      style={{ minHeight: 'calc(100dvh - 120px)' }}
    />
  );
}
