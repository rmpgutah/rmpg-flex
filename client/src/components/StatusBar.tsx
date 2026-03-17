// ============================================================
// RMPG Flex — Status Bar (Spillman Flex Bottom Bar)
// Global footer status bar with connection, operator, timestamp
// ============================================================

import React, { useState, useEffect } from 'react';
import RmpgLogo from './RmpgLogo';
import BatteryIndicator from './BatteryIndicator';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

interface StatusBarProps {
  isConnected: boolean;
  user: { first_name: string; last_name: string; role: string; badge_number?: string } | null;
  activeCallCount: number;
  activeBOLOs: number;
  gpsTracking?: boolean;
  gpsUnitCallSign?: string | null;
  gpsAccuracy?: number | null;
  gpsLastSent?: string | null;
}

export default function StatusBar({
  isConnected,
  user,
  activeCallCount,
  activeBOLOs,
  gpsTracking,
  gpsUnitCallSign,
  gpsAccuracy,
  gpsLastSent,
}: StatusBarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="status-bar">
      {/* Connection Status */}
      <div className="status-bar-section">
        <span className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`} />
        <span style={{ color: isConnected ? '#22c55e' : '#ef4444', textShadow: isConnected ? '0 0 6px rgba(34, 197, 94, 0.3)' : undefined }}>
          {isConnected ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>

      {/* Server */}
      <div className="status-bar-section">
        <RmpgLogo height={12} iconOnly />
        <span style={{ padding: '0 4px', background: '#0d1520', border: '1px solid #1e3048', borderRadius: '2px', fontSize: '9px', letterSpacing: '0.04em' }}>RMPG-FLEX v{APP_VERSION}</span>
      </div>

      {/* Active Calls */}
      <div className="status-bar-section">
        <span>CALLS: {activeCallCount}</span>
      </div>

      {/* BOLOs */}
      <div className="status-bar-section">
        {activeBOLOs > 0 && (
          <span className="led-dot led-red animate-led-blink" />
        )}
        <span style={activeBOLOs > 0 ? { color: '#ef4444' } : undefined}>
          BOLO: {activeBOLOs}
        </span>
      </div>

      {/* GPS Status */}
      <div className="status-bar-section">
        {gpsTracking ? (
          <>
            <span className="led-dot led-green animate-led-blink" />
            <span style={{ color: '#22c55e' }}>
              GPS: {gpsUnitCallSign || 'ON'}
            </span>
            {gpsAccuracy != null && (
              <span style={{ color: '#5a6e80', marginLeft: 4 }}>
                ±{Math.round(gpsAccuracy)}m
              </span>
            )}
            {gpsLastSent && (
              <span style={{ color: '#505050', marginLeft: 4 }}>
                {new Date(gpsLastSent).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: '#505050' }}>GPS: OFF</span>
        )}
      </div>

      {/* Operator */}
      <div className="status-bar-section">
        <span>
          OPR: {user?.badge_number || '---'} {user?.last_name?.toUpperCase() || '---'}
        </span>
      </div>

      {/* Battery */}
      <BatteryIndicator />

      {/* Timestamp (right-aligned) */}
      <div className="status-bar-section">
        <span className="clock-display">
          {now.toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <span style={{ color: '#5a6e80', marginLeft: 8 }}>
          {now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
    </div>
  );
}
