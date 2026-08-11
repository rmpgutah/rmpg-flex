import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { useDesktopSystem } from '../context/DesktopSystemContext';

interface UpdateWindow { enabled: boolean; startHour: number; endHour: number; }

const UPDATE_KEY = 'rmpg_update_window';

function loadSettings(): UpdateWindow {
  try { const raw = localStorage.getItem(UPDATE_KEY); return raw ? JSON.parse(raw) : { enabled: true, startHour: 2, endHour: 4 }; }
  catch { return { enabled: true, startHour: 2, endHour: 4 }; }
}

type ElectronAPI = { setUpdateWindow?: (w: UpdateWindow) => void; installUpdate?: () => void };

function fmtHour(h: number) { return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`; }

export default function ScheduledUpdatesPage() {
  const { updateAvailable } = useDesktopSystem();
  const [settings, setSettings] = useState<UpdateWindow>(loadSettings);

  function save(next: UpdateWindow) {
    setSettings(next);
    try { localStorage.setItem(UPDATE_KEY, JSON.stringify(next)); } catch { /* quota */ }
    try { (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.setUpdateWindow?.(next); } catch { /* non-Electron */ }
  }

  useEffect(() => { save(settings); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Download className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>SCHEDULED UPDATES</div>
      </div>
      {updateAvailable && (
        <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--brand-400)', borderRadius: 2, padding: 10, marginBottom: 12, fontSize: 10, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          FlexOS {updateAvailable} is ready.
          <button type="button" onClick={() => { try { (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.installUpdate?.(); } catch { /* non-Electron */ } }}
            style={{ fontSize: 9, padding: '2px 8px', background: 'var(--brand-400)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
            Install Now
          </button>
        </div>
      )}
      <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Auto-install updates</span>
          <button type="button" onClick={() => save({ ...settings, enabled: !settings.enabled })}
            style={{ width: 32, height: 16, borderRadius: 8, border: 'none', cursor: 'pointer', background: settings.enabled ? 'var(--brand-400)' : 'var(--border-subtle)', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 2, left: settings.enabled ? 16 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.1s' }} />
          </button>
        </div>
        {settings.enabled && (
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 4 }}>START HOUR</div>
              <select value={settings.startHour} onChange={e => save({ ...settings, startHour: Number(e.target.value) })}
                style={{ width: '100%', fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}>
                {hours.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 4 }}>END HOUR</div>
              <select value={settings.endHour} onChange={e => save({ ...settings, endHour: Number(e.target.value) })}
                style={{ width: '100%', fontSize: 10, padding: '4px 6px', background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}>
                {hours.map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
              </select>
            </div>
          </>
        )}
        <div style={{ marginTop: 10, fontSize: 9, color: 'var(--text-secondary)' }}>
          {settings.enabled ? `Updates install automatically between ${fmtHour(settings.startHour)} – ${fmtHour(settings.endHour)}` : 'Updates must be installed manually.'}
        </div>
      </div>
    </div>
  );
}
