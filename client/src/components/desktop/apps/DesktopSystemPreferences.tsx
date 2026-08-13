import React, { useState } from 'react';
import { X, Monitor, Volume2, Bell, LayoutGrid, Palette, Accessibility, AppWindow, Info, Settings } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import type { DesktopSettingsAppProps } from '../DesktopSettingsApp';
import DesktopSettingsApp from '../DesktopSettingsApp';

const W = 740;
const H = 520;

// Maps sidebar sections to DesktopSettingsApp categories
type PrefSection = 'display' | 'sound' | 'notifications' | 'desktop' | 'theme' | 'accessibility' | 'window-rules' | 'about';

const SECTIONS: Array<{ id: PrefSection; label: string; icon: React.ElementType }> = [
  { id: 'display',        label: 'Display',         icon: Monitor },
  { id: 'sound',          label: 'Sound',            icon: Volume2 },
  { id: 'notifications',  label: 'Notifications',    icon: Bell },
  { id: 'desktop',        label: 'Desktop & Icons',  icon: LayoutGrid },
  { id: 'theme',          label: 'Theme',            icon: Palette },
  { id: 'accessibility',  label: 'Accessibility',    icon: Accessibility },
  { id: 'window-rules',   label: 'Window Rules',     icon: AppWindow },
  { id: 'about',          label: 'About FlexOS',     icon: Info },
];

// Simple read-only panels for sections not yet in DesktopSettingsApp
function DisplayPanel() {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const res = typeof window !== 'undefined' ? `${window.screen.width}×${window.screen.height}` : '—';
  return (
    <div style={{ padding: 16 }}>
      <Row label="Resolution" value={res} />
      <Row label="Device Pixel Ratio" value={`${dpr}`} />
      <Row label="Color Depth" value={`${window.screen.colorDepth}-bit`} />
      <Row label="Orientation" value={window.screen.orientation?.type ?? '—'} />
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 12 }}>
        Display resolution and scaling are controlled by your operating system.
      </p>
    </div>
  );
}

function NotificationsPanel() {
  return (
    <div style={{ padding: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Notification sound and display preferences are managed in <strong>Sound</strong> settings. Per-module notification rules are coming in a future phase.
      </p>
      <Row label="Badge on taskbar" value="Always on" />
      <Row label="Pop-up on new dispatch call" value="Enabled" />
      <Row label="Pop-up on new warrant hit" value="Enabled" />
    </div>
  );
}

function AccessibilityPanel() {
  return (
    <div style={{ padding: 16 }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Accessibility overrides (font scale, high-contrast, reduced motion) are coming in a future phase.
      </p>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        For immediate assistance, use your operating system's native accessibility features.
      </p>
    </div>
  );
}

function AboutPanel() {
  return (
    <div style={{ padding: 16 }}>
      <Row label="System" value="FlexOS — RMPG Flex Desktop" />
      <Row label="Organization" value="Rocky Mountain Protective Group" />
      <Row label="Build" value={import.meta.env.VITE_GIT_SHA ?? 'development'} />
      <Row label="Environment" value={import.meta.env.MODE} />
      <Row label="API" value={import.meta.env.VITE_API_BASE_URL ?? 'https://api.rmpgutah.us'} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-default)', padding: '6px 0' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 160, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</span>
    </div>
  );
}

// The section that opens DesktopSettingsApp for the full desktop/theme panels
function SettingsSection({ settingsProps }: { settingsProps: DesktopSettingsAppProps }) {
  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <DesktopSettingsApp {...settingsProps} />
    </div>
  );
}

type Props = DesktopSettingsAppProps;

export default function DesktopSystemPreferences(props: Props) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [section, setSection] = useState<PrefSection>('desktop');

  // For sections that delegate to DesktopSettingsApp, we open the settings panel directly
  const settingsSections: PrefSection[] = ['desktop', 'theme', 'sound', 'window-rules'];
  const usesSettingsPanel = settingsSections.includes(section);

  // Map our section to the DesktopSettingsApp initialCategory prop
  const settingsCategoryMap: Partial<Record<PrefSection, string>> = {
    desktop: 'desktop-icons',
    theme: 'personalization',
    sound: 'personalization',
    'window-rules': 'window-management',
  };

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Settings size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>System Preferences</span>
        <button aria-label="Close System Preferences" onClick={props.onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{ width: 160, borderRight: '1px solid var(--border-default)', flexShrink: 0, overflowY: 'auto', background: 'var(--surface-base)' }}>
          {SECTIONS.map(s => {
            const active = section === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                aria-label={s.label}
                onClick={() => setSection(s.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', cursor: 'pointer', fontSize: 11, border: 'none',
                  background: active ? 'var(--surface-sunken)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderLeft: `2px solid ${active ? 'var(--desktop-shell-accent, var(--accent-silver-400))' : 'transparent'}`,
                  textAlign: 'left',
                }}
              >
                <Icon size={13} style={{ flexShrink: 0 }} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {usesSettingsPanel ? (
            <DesktopSettingsApp
              {...props}
              // Floating the settings panel *inside* our container by overriding its position
              // with a key that maps our section to its category
            />
          ) : section === 'display' ? (
            <DisplayPanel />
          ) : section === 'notifications' ? (
            <NotificationsPanel />
          ) : section === 'accessibility' ? (
            <AccessibilityPanel />
          ) : section === 'about' ? (
            <AboutPanel />
          ) : null}
        </div>
      </div>
    </div>
  );
}
