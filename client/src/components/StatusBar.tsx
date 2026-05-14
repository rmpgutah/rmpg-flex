// ============================================================
// RMPG Flex — Status Bar (Spillman Flex Bottom Bar)
// Global footer status bar with connection, operator, timestamp
// ============================================================

import { useState, useEffect } from 'react';
import RmpgLogo from './RmpgLogo';
import BatteryIndicator from './BatteryIndicator';
import StatusBarRadio from './StatusBarRadio';
import { safeTimeStr } from '../utils/dateUtils';

const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

interface StatusBarProps {
  isConnected: boolean;
  /**
   * True only after the WebSocket has exhausted its reconnect budget
   * (~25 min). Distinguishes "we're working on it" from "give up".
   */
  connectionLost?: boolean;
  user: { first_name: string; last_name: string; role: string; badge_number?: string } | null;
  activeCallCount: number;
  callsByPriority?: { priority: string; count: number }[];
  activeBOLOs: number;
  gpsTracking?: boolean;
  gpsUnitCallSign?: string | null;
  gpsAccuracy?: number | null;
  gpsLastSent?: string | null;
}

export default function StatusBar({
  isConnected,
  connectionLost = false,
  user,
  activeCallCount,
  callsByPriority,
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
      {/* 26: Connection Status with uppercase tracking.
          Three states: CONNECTED (green), RECONNECTING (amber, while
          WS is auto-retrying), OFFLINE (red, after retries exhausted). */}
      <div className="status-bar-section" style={{ letterSpacing: '0.04em' }}>
        {(() => {
          let label = 'CONNECTED';
          let color = '#22c55e';
          let ledClass = 'led-green';
          if (!isConnected) {
            if (connectionLost) {
              label = 'OFFLINE';
              color = '#ef4444';
              ledClass = 'led-red animate-led-blink';
            } else {
              label = 'RECONNECTING';
              color = '#f59e0b';
              ledClass = 'led-amber animate-led-blink';
            }
          }
          return (
            <>
              <span className={`led-dot ${ledClass}`} />
              <span style={{ color, fontWeight: 700 }}>{label}</span>
            </>
          );
        })()}
      </div>

      {/* 27: Server version with logo */}
      <div className="status-bar-section">
        <RmpgLogo height={12} iconOnly />
        <span style={{ letterSpacing: '0.02em' }}>RMPG-FLEX v{APP_VERSION}</span>
      </div>

      {/* 28: Active Calls with tabular-nums and color highlight + priority breakdown */}
      <div className="status-bar-section">
        <span>CALLS: <span className="tabular-nums" style={activeCallCount > 0 ? { color: '#ef7a7a', fontWeight: 700 } : undefined}>{activeCallCount}</span>
        {callsByPriority && callsByPriority.length > 0 && activeCallCount > 0 && (
          <span style={{ color: '#666666', marginLeft: 4 }}>
            ({callsByPriority.filter(p => p.count > 0).map(p => `${p.count} ${p.priority}`).join(', ')})
          </span>
        )}
        </span>
      </div>

      {/* 29: BOLOs with tabular-nums */}
      <div className="status-bar-section">
        {activeBOLOs > 0 && (
          <span className="led-dot led-red animate-led-blink" />
        )}
        <span style={activeBOLOs > 0 ? { color: '#ef4444', fontWeight: 700 } : undefined}>
          BOLO: <span className="tabular-nums">{activeBOLOs}</span>
        </span>
      </div>

      {/* 30: GPS Status with tabular-nums for accuracy/time */}
      <div className="status-bar-section">
        {gpsTracking ? (() => {
          const ageSec = gpsLastSent ? (Date.now() - new Date(gpsLastSent).getTime()) / 1000 : Infinity;
          const isLost = ageSec > 600;     // >10 min
          const isStale = ageSec > 120;    // >2 min
          const ledClass = isLost ? 'led-red' : isStale ? 'led-amber' : 'led-green';
          const gpsColor = isLost ? '#ef4444' : isStale ? '#f59e0b' : '#22c55e';
          return (
            <>
              <span className={`led-dot ${ledClass} animate-led-blink`} />
              <span style={{ color: gpsColor, fontWeight: 700 }}>
                GPS: {gpsUnitCallSign || 'ON'}
              </span>
              {gpsAccuracy != null && (
                <span className="tabular-nums" style={{ color: '#666666', marginLeft: 4 }}>
                  ±{Math.round(gpsAccuracy)}m
                </span>
              )}
              {gpsLastSent && (
                <span className="tabular-nums" style={{ color: isStale ? gpsColor : '#505050', marginLeft: 4 }}>
                  {safeTimeStr(gpsLastSent)}
                </span>
              )}
            </>
          );
        })() : (
          <span style={{ color: '#3a3a3a' }}>GPS: OFF</span>
        )}
      </div>

      {/* Shift Timer */}
      <div className="status-bar-section">
        <span style={{ color: '#888' }}>SHIFT: <span className="tabular-nums" style={{ color: '#d4a017' }}>{(() => {
          const h = now.getHours();
          if (h >= 6 && h < 14) return 'DAY';
          if (h >= 14 && h < 22) return 'SWING';
          return 'GRAVE';
        })()}</span></span>
      </div>

      {/* Operator */}
      <div className="status-bar-section">
        <span>
          OPR: {user?.badge_number || '---'} {user?.last_name?.toUpperCase() || '---'}
        </span>
      </div>

      {/* Memory / Performance */}
      <div className="status-bar-section">
        <span style={{ color: '#3a3a3a' }}>FPS: <span className="tabular-nums" style={{ color: '#666' }}>60</span></span>
      </div>

      {/* Radio */}
      <StatusBarRadio />

      {/* Battery */}
      <BatteryIndicator />

      {/* Hotkey hints */}
      <div className="status-bar-section" style={{ color: '#2a2a2a' }}>
        <span>F2:DSP F3:MAP F5:NCIC F6:REC</span>
      </div>

      {/* 31: Timestamp with tabular-nums for stable clock rendering */}
      <div className="status-bar-section">
        <span className="tabular-nums" style={{ color: '#22c55e', fontWeight: 700, letterSpacing: '0.02em' }}>
          {now.toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <span style={{ color: '#666666', marginLeft: 8 }}>
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
