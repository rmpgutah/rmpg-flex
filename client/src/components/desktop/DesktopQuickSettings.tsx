import React from 'react';
import { Moon, BellOff, Wifi, RefreshCw } from 'lucide-react';
import { useOptionalDesktopSystem } from '../../context/DesktopSystemContext';

const UNIT_STATUSES = ['available', 'busy', 'on-call', 'traffic-stop', 'out-of-service'];

export default function DesktopQuickSettings({ onClose }: { onClose: () => void }) {
  const ctx = useOptionalDesktopSystem();
  const { nightLightOn = false, nightLightIntensity = 50, dndOn = false, brightness = 100, syncPending = 0, unitStatus = 'available', setNightLight = () => {}, setDnd = () => {}, setBrightness = () => {}, setUnitStatus = async () => {} } = ctx ?? {};

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', bottom: '100%', right: 0, width: 260, marginBottom: 4, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12, zIndex: 20000 }}
    >
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 10 }}>QUICK SETTINGS</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Night Light */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Moon className="w-3.5 h-3.5" style={{ color: nightLightOn ? 'var(--sev-warn, #f59e0b)' : 'var(--text-secondary)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Night Light</span>
          <button
            type="button"
            onClick={() => setNightLight(!nightLightOn)}
            style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', background: nightLightOn ? 'var(--sev-warn, #f59e0b)' : 'var(--border-subtle)', position: 'relative' }}
          >
            <span style={{ position: 'absolute', top: 2, left: nightLightOn ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.1s' }} />
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
            <span style={{ position: 'absolute', top: 2, left: dndOn ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.1s' }} />
          </button>
        </div>

        {/* Wi-Fi status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wifi className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok, #22c55e)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Wi-Fi</span>
          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{navigator.onLine ? 'Connected' : 'Offline'}</span>
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
            <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--sev-warn, #f59e0b)', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 10, color: 'var(--sev-warn, #f59e0b)' }}>{syncPending} record{syncPending !== 1 ? 's' : ''} pending sync</span>
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
