/**
 * FlexOS — OS-level settings panel
 *
 * Embedded as a tab inside DesktopSettingsApp. Controls:
 *   - Auto-lock idle threshold
 *   - Screensaver idle threshold
 *   - Workspace labels (CAD/RMS/Intel/Admin defaults)
 *   - About FlexOS section
 */
import React, { useState, useCallback } from 'react';
import { Shield, Clock, Monitor, Layers, Info } from 'lucide-react';
import FlexOSAbout from './FlexOSAbout';
import { WORKSPACE_COUNT, WORKSPACE_LABELS } from './DesktopVirtualDesktops';

const LOCK_SECS_KEY = 'rmpg_desktop_autolock_secs';
const SS_SECS_KEY = 'rmpg_desktop_screensaver_secs';
const WS_LABELS_KEY = 'rmpg_desktop_workspace_labels';

function readInt(key: string, fallback: number): number {
  try { const v = localStorage.getItem(key); return v ? parseInt(v, 10) : fallback; } catch { return fallback; }
}
function writeInt(key: string, v: number) { try { localStorage.setItem(key, String(v)); } catch { /* ignore */ } }

function readWorkspaceLabels(): string[] {
  try {
    const raw = localStorage.getItem(WS_LABELS_KEY);
    if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length === WORKSPACE_COUNT) return a; }
  } catch { /* ignore */ }
  return [...WORKSPACE_LABELS];
}

function writeWorkspaceLabels(labels: string[]) {
  try { localStorage.setItem(WS_LABELS_KEY, JSON.stringify(labels)); } catch { /* ignore */ }
}

type SubPage = 'main' | 'about';

const LOCK_OPTIONS = [
  { label: '2 minutes', secs: 120 },
  { label: '5 minutes', secs: 300 },
  { label: '10 minutes', secs: 600 },
  { label: '15 minutes', secs: 900 },
  { label: '30 minutes', secs: 1800 },
  { label: 'Never', secs: 0 },
];

const SS_OPTIONS = [
  { label: '30 seconds', secs: 30 },
  { label: '1 minute', secs: 60 },
  { label: '2 minutes', secs: 120 },
  { label: '5 minutes', secs: 300 },
  { label: 'Never', secs: 0 },
];

export default function FlexOSSettings() {
  const [subPage, setSubPage] = useState<SubPage>('main');
  const [lockSecs, setLockSecsState] = useState(() => readInt(LOCK_SECS_KEY, 900));
  const [ssSecs, setSsSecsState] = useState(() => readInt(SS_SECS_KEY, 120));
  const [wsLabels, setWsLabels] = useState(() => readWorkspaceLabels());

  const handleLockChange = useCallback((secs: number) => {
    setLockSecsState(secs);
    writeInt(LOCK_SECS_KEY, secs);
  }, []);

  const handleSsChange = useCallback((secs: number) => {
    setSsSecsState(secs);
    writeInt(SS_SECS_KEY, secs);
  }, []);

  const handleLabelChange = useCallback((i: number, val: string) => {
    setWsLabels(prev => {
      const next = [...prev];
      next[i] = val.slice(0, 12).toUpperCase();
      writeWorkspaceLabels(next);
      return next;
    });
  }, []);

  if (subPage === 'about') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSubPage('main')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 4 }}
        >
          ← Back
        </button>
        <FlexOSAbout />
      </div>
    );
  }

  const Section = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Icon className="w-3.5 h-3.5 text-accent-silver-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-accent-silver-400">{title}</span>
        </div>
        {children}
      </div>
  );

  const SelectRow = ({ label, value, options, onChange }: { label: string; value: number; options: { label: string; secs: number }[]; onChange: (s: number) => void }) => (
    <div className="flex items-center justify-between py-1 border-b border-border-subtle/10">
      <span className="text-xs text-text-secondary">{label}</span>
      <select
        value={value}
        onChange={e => onChange(parseInt(e.target.value, 10))}
        className="text-xs bg-surface-sunken border border-border-subtle px-2 py-1 text-text-primary"
      >
        {options.map(o => <option key={o.secs} value={o.secs}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 440 }}>
      {/* FlexOS header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Shield style={{ width: 18, height: 18, color: 'var(--accent-silver-400)' }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>FlexOS</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Rocky Mountain Protective Group</div>
        </div>
      </div>

      {/* Security */}
      <Section icon={Clock} title="Security & Lock">
        <SelectRow label="Auto-lock after" value={lockSecs} options={LOCK_OPTIONS} onChange={handleLockChange} />
        <SelectRow label="Screensaver after" value={ssSecs} options={SS_OPTIONS} onChange={handleSsChange} />
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          Changes take effect on the next idle cycle.
        </div>
      </Section>

      {/* Virtual Desktops */}
      <Section icon={Layers} title="Workspace Labels">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {wsLabels.map((label, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Workspace {i + 1} (Ctrl+{i + 1})</span>
                <input
                  type="text"
                  value={label}
                  maxLength={12}
                  onChange={e => handleLabelChange(i, e.target.value)}
                  className="text-sm bg-surface-sunken border border-border-subtle px-2 py-1 font-semibold tracking-widest uppercase"
                />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          Labels saved locally. Reload the desktop shell to apply.
        </div>
      </Section>

      {/* About */}
      <Section icon={Info} title="About">
        <button
          type="button"
          onClick={() => setSubPage('about')}
          className="w-full p-2 text-sm flex items-center justify-between bg-surface-sunken border border-border-subtle text-text-primary cursor-pointer"
        >
          <span>About FlexOS</span>
          <span className="text-text-muted">→</span>
        </button>
      </Section>
    </div>
  );
}
