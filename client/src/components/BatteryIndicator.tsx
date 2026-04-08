// ============================================================
// Battery Indicator — Status bar battery level display
// Uses Browser Battery API (Chrome/Android) or Electron powerMonitor
// Shows icon + percentage with color thresholds
// ============================================================

import { useState, useEffect } from 'react';

interface BatteryState {
  level: number;      // 0–100
  charging: boolean;
  supported: boolean;
}

// Extend navigator for Battery API (not in all TS lib defs)
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
}

declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
}

function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({ level: 100, charging: false, supported: false });

  useEffect(() => {
    let battery: BatteryManager | null = null;

    const update = () => {
      if (battery) {
        setState({
          level: Math.round(battery.level * 100),
          charging: battery.charging,
          supported: true,
        });
      }
    };

    if (navigator.getBattery) {
      navigator.getBattery().then(bm => {
        battery = bm;
        update();
        bm.addEventListener('levelchange', update);
        bm.addEventListener('chargingchange', update);
      }).catch(() => {
        // Battery API not available
      });
    }

    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', update);
        battery.removeEventListener('chargingchange', update);
      }
    };
  }, []);

  return state;
}

function getBatteryColor(level: number, charging: boolean): string {
  if (charging) return '#22c55e';
  if (level >= 50) return '#22c55e';
  if (level >= 20) return '#f59e0b';
  return '#ef4444';
}

function getBatteryIcon(level: number, charging: boolean): string {
  if (charging) return '⚡';
  if (level >= 80) return '█████';
  if (level >= 60) return '████░';
  if (level >= 40) return '███░░';
  if (level >= 20) return '██░░░';
  return '█░░░░';
}

interface BatteryIndicatorProps {
  compact?: boolean; // For mobile — just icon + %
}

export default function BatteryIndicator({ compact }: BatteryIndicatorProps) {
  const { level, charging, supported } = useBattery();

  if (!supported) return null;

  const color = getBatteryColor(level, charging);
  const isLow = level <= 19 && !charging;

  if (compact) {
    return (
      <span
        style={{ color, fontSize: '11px', fontFamily: 'monospace' }}
        className={isLow ? 'animate-led-blink' : ''}
      >
        {charging ? '⚡' : '🔋'}{level}%
      </span>
    );
  }

  // Desktop status bar style — battery bar + percentage
  return (
    <div className="status-bar-section" style={{ gap: 4 }}>
      {/* Battery bar */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: `1px solid ${color}`,
          borderRadius: 2,
          padding: '1px 2px',
          fontSize: '7px',
          lineHeight: 1,
          position: 'relative',
          width: 22,
          height: 10,
        }}
      >
        {/* Fill bar */}
        <div
          style={{
            width: `${level}%`,
            height: '100%',
            background: color,
            borderRadius: 1,
            transition: 'width 1s ease',
          }}
        />
        {/* Battery tip */}
        <div
          style={{
            position: 'absolute',
            right: -3,
            top: 2,
            width: 2,
            height: 5,
            background: color,
            borderRadius: '0 1px 1px 0',
          }}
        />
      </div>
      <span
        style={{ color, fontSize: '11px', fontFamily: 'var(--font-mono, monospace)' }}
        className={isLow ? 'animate-led-blink' : ''}
      >
        {charging && '⚡'}{level}%
      </span>
    </div>
  );
}
