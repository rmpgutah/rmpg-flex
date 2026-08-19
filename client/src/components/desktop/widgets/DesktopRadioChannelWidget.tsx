import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Radio } from 'lucide-react';
import { useOptionalDesktopSystem } from '../../../context/DesktopSystemContext';
import { playToneAsync } from '../../../utils/dispatchTones';

const CHANNELS: Record<string, string> = {
  CH1: 'Patrol Primary',
  CH2: 'Patrol Secondary',
  TAC1: 'Tactical 1',
  TAC2: 'Tactical 2',
  CMD: 'Command',
  DISPATCH: 'Dispatch',
  SECURE1: 'Secure 1',
  EMERGENCY: 'Emergency',
};

const CHANNEL_KEYS = Object.keys(CHANNELS);

function getLastTxLabel(channelKey: string): string {
  try {
    const raw = localStorage.getItem('rmpg_last_radio_tx');
    if (!raw) return 'Last Tx: --';
    const data = JSON.parse(raw) as Record<string, number>;
    const ts = data[channelKey];
    if (!ts) return 'Last Tx: --';
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Last Tx: <1m ago';
    if (diffMin < 60) return `Last Tx: ${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `Last Tx: ${diffHr}h ago`;
  } catch {
    return 'Last Tx: --';
  }
}

function touchLastTx(channelKey: string) {
  try {
    const raw = localStorage.getItem('rmpg_last_radio_tx');
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    data[channelKey] = Date.now();
    localStorage.setItem('rmpg_last_radio_tx', JSON.stringify(data));
  } catch {
    // ignore
  }
}

export default function DesktopRadioChannelWidget() {
  const desktop = useOptionalDesktopSystem();
  const radioChannel: string = desktop?.radioChannel ?? 'CH1';
  const setRadioChannel: (ch: string) => void = desktop?.setRadioChannel ?? (() => {});

  const [scanning, setScanning] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [lastTxLabel, setLastTxLabel] = useState(() => getLastTxLabel(radioChannel));
  const scanIndexRef = useRef(CHANNEL_KEYS.indexOf(radioChannel));
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Refresh last tx label every 30s
  useEffect(() => {
    setLastTxLabel(getLastTxLabel(radioChannel));
    const t = setInterval(() => setLastTxLabel(getLastTxLabel(radioChannel)), 30000);
    return () => clearInterval(t);
  }, [radioChannel]);

  // Scanning
  useEffect(() => {
    if (scanning) {
      scanTimerRef.current = setInterval(() => {
        scanIndexRef.current = (scanIndexRef.current + 1) % CHANNEL_KEYS.length;
        setRadioChannel(CHANNEL_KEYS[scanIndexRef.current]);
      }, 2000);
    } else {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    }
    return () => {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    };
  }, [scanning, setRadioChannel]);

  // PTT: space key while container focused
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (radioChannel === 'EMERGENCY') {
        // Emergency channel is receive-only for console; play TX Denied tone
        void playToneAsync('radio_deny');
        return;
      }
      setPttActive(true);
      // Talk Permit Tone — real APX hardware recording
      void playToneAsync('key_up');
    }
  }, [radioChannel]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault();
      setPttActive(false);
      // De-key acknowledgment
      void playToneAsync('key_out');
    }
  }, []);

  const handleChannelSelect = useCallback((chKey: string) => {
    if (scanning) setScanning(false);
    setRadioChannel(chKey);
    touchLastTx(chKey);
    scanIndexRef.current = CHANNEL_KEYS.indexOf(chKey);
    // Trunked channel-grant chirp when switching channels
    void playToneAsync('radio_grant');
  }, [scanning, setRadioChannel]);

  const toggleScan = useCallback(() => {
    setScanning(s => {
      if (!s) {
        scanIndexRef.current = CHANNEL_KEYS.indexOf(radioChannel);
      }
      return !s;
    });
  }, [radioChannel]);

  const currentName = CHANNELS[radioChannel] ?? radioChannel;
  const isEmergency = radioChannel === 'EMERGENCY';

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      style={{
        padding: 8,
        outline: 'none',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Radio className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
          <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Radio
          </span>
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
          SQ: ON
        </span>
      </div>

      {/* Current channel display */}
      <div style={{
        background: 'var(--surface-sunken)',
        border: `1px solid ${isEmergency ? 'var(--sev-critical)' : 'var(--border-subtle)'}`,
        borderRadius: 2,
        padding: '5px 8px',
        marginBottom: 6,
        position: 'relative',
      }}>
        <div style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.1em',
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          marginBottom: 2,
        }}>
          {radioChannel}
        </div>
        <div style={{
          fontSize: 14,
          fontWeight: 700,
          color: isEmergency ? 'var(--sev-critical)' : 'var(--text-primary)',
          lineHeight: 1.2,
        }}>
          {currentName}
        </div>
        {/* PTT badge */}
        {pttActive && (
          <div style={{
            position: 'absolute',
            top: 5,
            right: 8,
            fontSize: 8,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--sev-critical)',
            borderRadius: 2,
            padding: '1px 4px',
            letterSpacing: '0.06em',
            animation: 'rmpg-pulse 0.6s infinite',
          }}>
            PTT ACTIVE
          </div>
        )}
        {/* Scanning indicator */}
        {scanning && !pttActive && (
          <div style={{
            position: 'absolute',
            top: 5,
            right: 8,
            fontSize: 8,
            fontWeight: 700,
            color: 'var(--brand-300)',
            borderRadius: 2,
            padding: '1px 4px',
            letterSpacing: '0.06em',
            animation: 'rmpg-pulse 1s infinite',
          }}>
            SCANNING
          </div>
        )}
      </div>

      {/* Last Tx + Scan button row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{lastTxLabel}</span>
        <button
          type="button"
          onClick={toggleScan}
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 2,
            border: `1px solid ${scanning ? 'var(--brand-400)' : 'var(--border-subtle)'}`,
            background: scanning ? 'var(--brand-400)' : 'var(--surface-raised)',
            color: scanning ? '#fff' : 'var(--text-primary)',
            cursor: 'pointer',
            letterSpacing: '0.06em',
          }}
        >
          SCAN
        </button>
      </div>

      {/* Channel grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        {CHANNEL_KEYS.map(chKey => {
          const isActive = chKey === radioChannel;
          const isEmerg = chKey === 'EMERGENCY';
          return (
            <button
              key={chKey}
              type="button"
              onClick={() => handleChannelSelect(chKey)}
              style={{
                fontSize: 9,
                fontWeight: isActive ? 700 : 500,
                padding: '3px 5px',
                borderRadius: 2,
                border: `1px solid ${isEmerg ? 'var(--sev-critical)' : isActive ? 'var(--brand-400)' : 'var(--border-subtle)'}`,
                background: isEmerg && isActive
                  ? 'var(--sev-critical)'
                  : isActive
                  ? 'var(--brand-700)'
                  : isEmerg
                  ? 'color-mix(in srgb, var(--sev-critical) 12%, var(--surface-base))'
                  : 'var(--surface-base)',
                color: isEmerg && isActive
                  ? '#fff'
                  : isActive
                  ? 'var(--text-primary)'
                  : isEmerg
                  ? 'var(--sev-critical)'
                  : 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontSize: 8, opacity: 0.75, letterSpacing: '0.05em' }}>{chKey}</div>
              <div style={{ fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{CHANNELS[chKey]}</div>
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes rmpg-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
