// ============================================================
// RMPG Flex — Location Warning Banner
// Shows a dismissible warning banner when GPS location
// permission is denied. Also shows a WiFi tracking indicator
// when position is being obtained via WiFi instead of GPS.
// ============================================================

import { useState } from 'react';
import { AlertTriangle, X, Wifi } from 'lucide-react';
import type { ConnectionType, PositionSource } from '../hooks/useGpsTracking';

interface LocationGateProps {
  permissionDenied: boolean;
  permissionPending: boolean;
  error: string | null;
  onRetry: () => void;
  connectionType?: ConnectionType;
  positionSource?: PositionSource;
}

export default function LocationGate({ permissionDenied, onRetry, connectionType, positionSource }: LocationGateProps) {
  const [dismissed, setDismissed] = useState(false);
  const [wifiDismissed, setWifiDismissed] = useState(false);

  // WiFi tracking indicator — shown when tracking via WiFi positioning
  const showWifiIndicator = !wifiDismissed && !permissionDenied && connectionType === 'wifi' && (positionSource === 'wifi' || positionSource === 'ip');

  // Dismissible warning banner when permission denied
  if (permissionDenied) {
    return (
      <div style={{
        background: 'rgba(220, 38, 38, 0.12)',
        borderBottom: '1px solid #991b1b',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 11,
      }}>
        <AlertTriangle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
        <span style={{ color: '#ccc', flex: 1 }}>
          <strong style={{ color: '#ef4444' }}>Location disabled</strong>
          {' — '}GPS tracking is not active. Enable location access in your browser or device settings for full functionality.
        </span>
        <button type="button"
          onClick={onRetry}
          style={{
            padding: '3px 10px',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            cursor: 'pointer',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Retry
        </button>
        <button type="button"
          onClick={() => setDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#666666',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            flexShrink: 0,
          }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  // WiFi tracking indicator
  if (showWifiIndicator) {
    return (
      <div style={{
        background: 'rgba(136, 136, 136, 0.08)',
        borderBottom: '1px solid #222222',
        padding: '4px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
      }}>
        <Wifi size={12} color="#888888" style={{ flexShrink: 0 }} />
        <span style={{ color: '#888888', flex: 1 }}>
          Tracking via <strong style={{ color: '#888888' }}>WiFi positioning</strong> — accuracy may be reduced
        </span>
        <button type="button"
          onClick={() => setWifiDismissed(true)}
          style={{
            background: 'none',
            border: 'none',
            color: '#666666',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
            flexShrink: 0,
          }}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return null;
}
