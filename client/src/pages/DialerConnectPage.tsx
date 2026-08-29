import { useEffect } from 'react';
import { DIALER_HOST_ID } from '../components/dialerConnect';
import DialerConnectRecordingsPanel from '../components/DialerConnectRecordingsPanel';

/**
 * Dispatch-shell host for Dial Connect. The live iframe is owned by
 * `DialerPanel` (mounted once on Layout) so Twilio Voice stays registered
 * across CAD navigation. This page provides the recordings drawer plus the
 * dock the iframe positions into — the iframe must not cover the drawer.
 */
export default function DialerConnectPage() {
  useEffect(() => {
    document.title = 'Dialer Connect — RMPG Flex';
  }, []);

  return (
    <div
      className="flex flex-col md:flex-row h-full min-h-0 gap-2 p-2"
      style={{ minHeight: 'calc(100dvh - 120px)' }}
    >
      <DialerConnectRecordingsPanel />
      <div
        id={DIALER_HOST_ID}
        data-testid="dialer-connect-host"
        className="relative flex-1 w-full min-h-[240px] min-w-0"
      />
    </div>
  );
}
