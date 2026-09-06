import React, { useState, useCallback, useEffect } from 'react';
import { Moon, BellOff, Wifi, RefreshCw, Volume2, VolumeX, BatteryMedium, Zap, Focus, ChevronRight } from 'lucide-react';
import { useOptionalDesktopSystem, type FocusAssistLevel } from '../../context/DesktopSystemContext';
import WifiSelector from './WifiSelector';

const UNIT_STATUSES = ['available', 'busy', 'on-call', 'traffic-stop', 'out-of-service'];

export default function DesktopQuickSettings({ onClose, open }: { onClose: () => void; open?: boolean }) {
  const [battery, setBattery] = useState<{ percent: number | null; charging: boolean } | null>(null);
  const [network, setNetwork] = useState<{ ssid: string | null; signal: number | null } | null>(null);
  const [wifiSelectorOpen, setWifiSelectorOpen] = useState(false);
  const isElectron = !!(window as any).electron?.isElectron;

  useEffect(() => {
    if (open === false) return;
    const w = window as Window & { electron?: { getBattery?: () => Promise<unknown>; getNetwork?: () => Promise<unknown> } };
    w.electron?.getBattery?.().then(b => setBattery(b as typeof battery)).catch(() => {});
    w.electron?.getNetwork?.().then(n => setNetwork(n as typeof network)).catch(() => {});
  }, [open]);

  const ctx = useOptionalDesktopSystem();
  const { nightLightOn = false, nightLightIntensity = 50, dndOn = false, focusAssist = 'off', brightness = 100, volume = 100, syncPending = 0, unitStatus = 'available', setNightLight = () => {}, setDnd = () => {}, setFocusAssist = () => {}, setBrightness = () => {}, setVolume = () => {}, setUnitStatus = async () => {} } = ctx ?? {};

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', bottom: '100%', right: 0, width: 260, marginBottom: 4, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12, zIndex: 20000 }}
    >
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 10 }}>QUICK SETTINGS</div>

      {/* 500+ Features Control HUD Banner */}
      <button
        type="button"
        onClick={() => {
          window.dispatchEvent(new CustomEvent('flexos:open-kiosk-hud'));
          onClose();
        }}
        style={{
          width: '100%',
          padding: '8px 10px',
          marginBottom: 10,
          background: 'linear-gradient(180deg, rgba(212,160,23,0.15) 0%, rgba(212,160,23,0.05) 100%)',
          border: '1px solid var(--brand-gold)',
          borderRadius: 2,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          textAlign: 'left'
        }}
      >
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand-gold)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            500+ Features System HUD
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
            FZ-55 Telemetry · Kiosk Shell · Radar360
          </div>
        </div>
        <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--brand-gold)', marginLeft: 'auto', flexShrink: 0 }} />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Night Light */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Moon className="w-3.5 h-3.5" style={{ color: nightLightOn ? 'var(--sev-warn)' : 'var(--text-secondary)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Night Light</span>
          <button
            type="button"
            onClick={() => setNightLight(!nightLightOn)}
            style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', background: nightLightOn ? 'var(--sev-warn)' : 'var(--border-subtle)', position: 'relative' }}
          >
            <span style={{ position: 'absolute', top: 2, left: nightLightOn ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: 'var(--text-primary)', transition: 'left 0.1s' }} />
          </button>
        </div>
        {nightLightOn && (
          <div style={{ paddingLeft: 22 }}>
            <input type="range" min={10} max={100} value={nightLightIntensity} onChange={e => setNightLight(true, Number(e.target.value))} style={{ width: '100%', height: 4 }} />
          </div>
        )}

        {/* DND */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BellOff className="w-3.5 h-3.5" style={{ color: dndOn ? 'var(--brand-400)' : 'var(--text-secondary)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Do Not Disturb</span>
          <button
            type="button"
            onClick={() => setDnd(!dndOn)}
            style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', background: dndOn ? 'var(--brand-400)' : 'var(--border-subtle)', position: 'relative' }}
          >
            <span style={{ position: 'absolute', top: 2, left: dndOn ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: 'var(--text-primary)', transition: 'left 0.1s' }} />
          </button>
        </div>

        {/* Focus Assist */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Focus className="w-3.5 h-3.5" style={{ color: focusAssist !== 'off' ? 'var(--brand-400)' : 'var(--text-secondary)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Focus Assist</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['off', 'priority', 'alarms-only'] as FocusAssistLevel[]).map(level => (
              <button
                key={level}
                type="button"
                onClick={() => setFocusAssist(level)}
                style={{
                  flex: 1, fontSize: 8, padding: '3px 0', borderRadius: 2, border: '1px solid var(--border-subtle)', cursor: 'pointer',
                  background: focusAssist === level ? 'var(--brand-400)' : 'var(--surface-base)',
                  color: focusAssist === level ? '#fff' : 'var(--text-secondary)',
                  fontWeight: focusAssist === level ? 700 : 400,
                }}
              >
                {level === 'off' ? 'Off' : level === 'priority' ? 'Priority' : 'Alarms'}
              </button>
            ))}
          </div>
        </div>

        {/* Wi-Fi status — clickable in Electron to open full selector */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setWifiSelectorOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, textAlign: 'left',
            }}
            aria-label="Wi-Fi settings"
          >
            <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {network?.ssid ?? (navigator.onLine ? 'Connected' : 'Offline')}
            </span>
            {network?.signal != null && (
              <span style={{ fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0 }}>{network.signal}%</span>
            )}
            <ChevronRight className="w-3 h-3" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          </button>
          {wifiSelectorOpen && (
            <WifiSelector onClose={() => setWifiSelectorOpen(false)} />
          )}
        </div>

        {/* Volume */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {volume === 0
              ? <VolumeX className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              : <Volume2 className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            }
            <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Volume</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{volume}%</span>
          </div>
          <input type="range" min={0} max={100} value={volume} onChange={e => setVolume(Number(e.target.value))} style={{ width: '100%', height: 4 }} aria-label="Volume" />
        </div>

        {/* Brightness */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-primary)' }}>Brightness</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{brightness}%</span>
          </div>
          <input type="range" min={10} max={100} value={brightness} onChange={e => setBrightness(Number(e.target.value))} style={{ width: '100%', height: 4 }} />
        </div>

        {/* Sync pending */}
        {syncPending > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--sev-warn)', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, color: 'var(--sev-warn)' }}>{syncPending} record{syncPending !== 1 ? 's' : ''} pending sync</span>
          </div>
        )}

        {/* Unit status */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 4 }}>UNIT STATUS</div>
          <select
            value={unitStatus}
            onChange={e => setUnitStatus(e.target.value)}
            style={{ width: '100%', fontSize: 10, padding: '3px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}
          >
            {UNIT_STATUSES.map(s => (
              <option key={s} value={s}>{s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
        {/* Battery */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 4 }}>BATTERY</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {battery?.charging
              ? <Zap className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok)', flexShrink: 0 }} />
              : <BatteryMedium className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            }
            <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>
              {battery?.percent != null ? `${battery.percent}%` : '—'}
            </span>
            {battery?.charging && (
              <span style={{ fontSize: 9, color: 'var(--sev-ok)' }}>Charging</span>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{ marginTop: 10, fontSize: 9, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'center' }}
      >
        Close
      </button>
    </div>
  );
}
