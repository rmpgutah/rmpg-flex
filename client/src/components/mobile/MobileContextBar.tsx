// ============================================================
// Mobile Context Bar — Persistent officer context strip
// Shows: unit call sign, radio channel, active call number
// Always visible below the header (32px)
// ============================================================

import BatteryIndicator from '../BatteryIndicator';

interface MobileContextBarProps {
  unitCallSign?: string | null;
  radioChannel?: string | null;
  activeCallNumber?: string | null;
  isConnected: boolean;
  gpsTracking: boolean;
}

export default function MobileContextBar({
  unitCallSign,
  radioChannel,
  activeCallNumber,
  isConnected,
  gpsTracking,
}: MobileContextBarProps) {
  return (
    <div
      style={{
        height: 32,
        background: '#050505',
        borderBottom: '1px solid #222222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px',
        flexShrink: 0,
        gap: 8,
        overflow: 'hidden',
      }}
    >
      {/* Left: Unit + Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {/* Connection LED */}
        <span
          className={`led-dot ${isConnected ? 'led-green' : 'led-red animate-led-blink'}`}
          style={{ flexShrink: 0 }}
        />

        {/* Unit call sign */}
        <span
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 700,
            color: '#999999',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {unitCallSign || 'NO UNIT'}
        </span>

        {/* Separator */}
        <span style={{ color: '#2e2e2e', fontSize: 12 }}>│</span>

        {/* Radio channel */}
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            color: radioChannel ? '#22c55e' : '#666666',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {radioChannel || 'NO CH'}
        </span>

        {/* Active call */}
        {activeCallNumber && (
          <>
            <span style={{ color: '#2e2e2e', fontSize: 12 }}>│</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono, monospace)',
                color: '#f59e0b',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              CALL {activeCallNumber}
            </span>
          </>
        )}
      </div>

      {/* Right: GPS + Battery */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* GPS indicator */}
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono, monospace)',
            color: gpsTracking ? '#22c55e' : '#666666',
          }}
        >
          {gpsTracking ? 'GPS' : ''}
        </span>

        {/* Battery */}
        <BatteryIndicator compact />
      </div>
    </div>
  );
}
