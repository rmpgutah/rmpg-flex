import React, { useState, useEffect, useCallback } from 'react';
import { Camera, CircleDot, Battery, HardDrive, Play, Square } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface BodyCamStatus {
  recording: boolean;
  duration?: number;
  battery?: number;
  storage_remaining_gb?: number;
  device_id?: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export default function DesktopBodyCamWidget() {
  const [status, setStatus] = useState<BodyCamStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const hasElectron = typeof window !== 'undefined' && !!window.electron;

  const fetchStatus = useCallback(async () => {
    if (hasElectron && typeof window.electron?.getBodyCamStatus === 'function') {
      try {
        const result = await window.electron.getBodyCamStatus();
        if (result !== undefined) {
          setStatus(result);
          return;
        }
      } catch {
        // fall through to API
      }
    }
    // No web API equivalent — body cam status is Electron IPC only
    setStatus(null);
  }, [hasElectron]);

  useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
    const id = setInterval(fetchStatus, 10_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleStart = async () => {
    setActionPending(true);
    try {
      if (typeof window.electron?.startBodyCamRecording === 'function') {
        await window.electron.startBodyCamRecording();
      }
      await fetchStatus();
    } finally {
      setActionPending(false);
    }
  };

  const handleStop = async () => {
    setActionPending(true);
    try {
      if (typeof window.electron?.stopBodyCamRecording === 'function') {
        await window.electron.stopBodyCamRecording();
      }
      await fetchStatus();
    } finally {
      setActionPending(false);
    }
  };

  const lowStorage = status?.storage_remaining_gb !== undefined && status.storage_remaining_gb < 5;
  const lowBattery = status?.battery !== undefined && status.battery < 20;

  return (
    <div
      style={{
        background: 'rgb(var(--surface-raised-rgb))',
        border: '1px solid rgb(var(--border-subtle-rgb))',
        borderRadius: 2,
        padding: '6px 8px',
        minWidth: 160,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Widget label */}
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--panel-header-color)',
          marginBottom: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Camera size={10} />
        BODY CAM
      </div>

      {loading && !status ? (
        <div style={{ fontSize: 10, color: 'rgb(var(--text-secondary-rgb))' }}>Loading…</div>
      ) : status === null ? (
        /* No cam connected */
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Camera size={13} style={{ color: 'rgb(var(--text-secondary-rgb))' }} />
          <span style={{ fontSize: 10, color: 'rgb(var(--text-secondary-rgb))' }}>
            No body cam connected
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Status row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {status.recording ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--sev-critical)',
                    animation: 'bodycam-pulse 1s ease-in-out infinite',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--sev-critical)',
                    letterSpacing: '0.05em',
                  }}
                >
                  RECORDING
                </span>
                {status.duration !== undefined && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'rgb(var(--text-primary-rgb))',
                      fontVariantNumeric: 'tabular-nums',
                      marginLeft: 2,
                    }}
                  >
                    {formatDuration(status.duration)}
                  </span>
                )}
              </>
            ) : (
              <>
                <CircleDot size={10} style={{ color: 'var(--sev-ok)', flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--sev-ok)' }}>
                  Ready
                </span>
              </>
            )}
          </div>

          {/* Battery */}
          {status.battery !== undefined && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: lowBattery ? 'var(--sev-critical)' : 'rgb(var(--text-secondary-rgb))',
              }}
            >
              <Battery size={10} />
              <span style={{ fontSize: 10 }}>{status.battery}%</span>
              {lowBattery && (
                <span style={{ fontSize: 9, fontWeight: 600 }}>LOW</span>
              )}
            </div>
          )}

          {/* Storage */}
          {status.storage_remaining_gb !== undefined && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: lowStorage ? 'var(--sev-warn)' : 'rgb(var(--text-secondary-rgb))',
              }}
            >
              <HardDrive size={10} />
              <span style={{ fontSize: 10 }}>
                {status.storage_remaining_gb.toFixed(1)} GB free
              </span>
              {lowStorage && (
                <span style={{ fontSize: 9, fontWeight: 600 }}>LOW</span>
              )}
            </div>
          )}

          {/* Device ID */}
          {status.device_id && (
            <div
              style={{
                fontSize: 9,
                color: 'rgb(var(--text-tertiary-rgb, var(--text-secondary-rgb)))',
                letterSpacing: '0.03em',
              }}
            >
              {status.device_id}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            {!status.recording ? (
              <button
                onClick={handleStart}
                disabled={actionPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'var(--sev-critical)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 2,
                  cursor: actionPending ? 'not-allowed' : 'pointer',
                  opacity: actionPending ? 0.6 : 1,
                }}
              >
                <Play size={9} />
                Record
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={actionPending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 600,
                  background: 'rgb(var(--surface-sunken-rgb, var(--surface-raised-rgb)))',
                  color: 'rgb(var(--text-primary-rgb))',
                  border: '1px solid rgb(var(--border-subtle-rgb))',
                  borderRadius: 2,
                  cursor: actionPending ? 'not-allowed' : 'pointer',
                  opacity: actionPending ? 0.6 : 1,
                }}
              >
                <Square size={9} />
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes bodycam-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
