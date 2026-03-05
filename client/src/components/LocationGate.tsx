// ============================================================
// RMPG Flex — Location Warning Banner
// Shows a dismissible warning banner when GPS location
// permission is denied. Also shows a WiFi tracking indicator
// when position is being obtained via WiFi instead of GPS.
// ============================================================

import React, { useState } from 'react';
import { AlertTriangle, X, Wifi, WifiOff } from 'lucide-react';
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

  return (
    <>
      {/* WiFi tracking indicator bar */}
      {showWifiIndicator && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.10)',
          borderBottom: '1px solid #1e3a5f',
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
        }}>
          <Wifi size={13} color="#3b82f6" style={{ flexShrink: 0 }} />
          <span style={{ color: '#94a3b8', flex: 1 }}>
            <strong style={{ color: '#60a5fa' }}>WiFi tracking</strong>
            {' — '}Position via {positionSource === 'ip' ? 'IP geolocation' : 'WiFi triangulation'} (reduced accuracy).
            {' '}Breadcrumbs active on {connectionType} network.
          </span>
          <button
            onClick={() => setWifiDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#475569',
              cursor: 'pointer',
              padding: 2,
              display: 'flex',
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Permission denied warning bar */}
      {!dismissed && permissionDenied && (
        <div style={{
          background: 'rgba(188, 16, 16, 0.12)',
          borderBottom: '1px solid #5a1010',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11,
        }}>
          {connectionType === 'none' ? (
            <WifiOff size={14} color="#d93030" style={{ flexShrink: 0 }} />
          ) : (
            <AlertTriangle size={14} color="#d93030" style={{ flexShrink: 0 }} />
          )}
          <span style={{ color: '#ccc', flex: 1 }}>
            <strong style={{ color: '#d93030' }}>Location disabled</strong>
            {' — '}GPS tracking is not active. Enable location access in your browser or device settings for full functionality.
          </span>
          <button
            onClick={onRetry}
            style={{
              padding: '3px 10px',
              background: '#bc1010',
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
          <button
            onClick={() => setDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
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
      )}
    </>
  );
}
