import React, { useState, useRef, useCallback } from 'react';
import { X, Monitor, Volume2, Bell, LayoutGrid, Palette, Accessibility, AppWindow, Info, Settings, Upload, Check } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import type { DesktopSettingsAppProps } from '../DesktopSettingsApp';
import DesktopSettingsApp from '../DesktopSettingsApp';
import { apiFetch } from '../../../hooks/useApi';

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

// Navy-safe accent hues — maps hue° to a display label
const ACCENT_PRESETS = [
  { label: 'Silver',      value: '#c3ccd6' },
  { label: 'Steel Blue',  value: '#3e74a8' },
  { label: 'Gold',        value: '#d9bd72' },
  { label: 'Slate',       value: '#7b8fa6' },
  { label: 'Teal',        value: '#2a8c8c' },
  { label: 'Coral',       value: '#d47a5a' },
];

const WALLPAPER_STORAGE_KEY = 'rmpg_desktop_wallpaper';
const ACCENT_STORAGE_KEY = 'rmpg_desktop_accent';

function ThemePanel({ props }: { props: DesktopSettingsAppProps }) {
  const [accent, setAccent] = useState<string>(() => localStorage.getItem(ACCENT_STORAGE_KEY) ?? '#c3ccd6');
  const [uploading, setUploading] = useState(false);
  const [uploadOk, setUploadOk] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customAccent, setCustomAccent] = useState(accent);
  const fileRef = useRef<HTMLInputElement>(null);

  function applyAccent(hex: string) {
    setAccent(hex);
    setCustomAccent(hex);
    localStorage.setItem(ACCENT_STORAGE_KEY, hex);
    document.documentElement.style.setProperty('--desktop-shell-accent', hex);
  }

  const handleWallpaperFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setUploadErr('Only image files are supported.'); return; }
    if (file.size > 8 * 1024 * 1024) { setUploadErr('Max wallpaper size is 8 MB.'); return; }
    setUploading(true); setUploadErr(null); setUploadOk(false);
    try {
      const form = new FormData();
      form.append('wallpaper', file);
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'https://api.rmpgutah.us'}/api/preferences/wallpaper`, {
        method: 'POST',
        body: form,
        headers: { Authorization: `Bearer ${localStorage.getItem('rmpg_token') ?? ''}` },
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const objectUrl = URL.createObjectURL(file);
      localStorage.setItem(WALLPAPER_STORAGE_KEY, objectUrl);
      window.dispatchEvent(new CustomEvent('flexos-wallpaper-changed', { detail: { url: objectUrl } }));
      setUploadOk(true);
      setTimeout(() => setUploadOk(false), 3000);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--field-label-color)', marginBottom: 8, marginTop: 16 }}>
      {children}
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      {/* Theme selector — delegates to settings app embedded in the parent component */}
      <SectionLabel>Color Theme</SectionLabel>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        Switch between Blue &amp; Silver, Night, Day, and Legacy Black in the main <strong>Theme</strong> settings below.
      </p>
      <DesktopSettingsApp {...props} />

      <SectionLabel>Accent Color</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {ACCENT_PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            aria-label={`Accent: ${p.label}`}
            onClick={() => applyAccent(p.value)}
            title={p.label}
            style={{
              width: 28, height: 28, borderRadius: 2, border: `2px solid ${accent === p.value ? 'var(--text-primary)' : 'transparent'}`,
              background: p.value, cursor: 'pointer', position: 'relative',
            }}
          />
        ))}
      </div>

      {/* Advanced expander */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(v => !v)}
        style={{ fontSize: 11, color: 'var(--accent-silver-400)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 12 }}
      >
        {advancedOpen ? '▾' : '▸'} Advanced
      </button>
      {advancedOpen && (
        <div style={{ padding: '12px', background: 'var(--surface-base)', borderRadius: 2, marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            Custom accent color
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={customAccent}
              onChange={e => setCustomAccent(e.target.value)}
              style={{ width: 36, height: 28, border: 'none', borderRadius: 2, cursor: 'pointer', background: 'none' }}
            />
            <button
              type="button"
              onClick={() => applyAccent(customAccent)}
              style={{ fontSize: 11, padding: '4px 10px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-primary)' }}
            >
              Apply
            </button>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Arial, sans-serif' }}>{customAccent}</span>
          </div>
        </div>
      )}

      <SectionLabel>Wallpaper</SectionLabel>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleWallpaperFile(f); }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2, cursor: uploading ? 'wait' : 'pointer', color: 'var(--text-primary)' }}
      >
        {uploadOk ? <Check size={12} style={{ color: 'var(--sev-ok)' }} /> : <Upload size={12} />}
        {uploading ? 'Uploading…' : uploadOk ? 'Wallpaper set' : 'Upload wallpaper image'}
      </button>
      {uploadErr && (
        <p style={{ fontSize: 11, color: 'var(--sev-critical)', marginTop: 6 }}>{uploadErr}</p>
      )}
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        JPEG or PNG, max 8 MB. Applied immediately and saved to your account.
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
      <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'Arial, sans-serif' }}>{value}</span>
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
  const settingsSections: PrefSection[] = ['desktop', 'sound', 'window-rules'];
  const usesSettingsPanel = settingsSections.includes(section);

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
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
            <DesktopSettingsApp {...props} />
          ) : section === 'display' ? (
            <DisplayPanel />
          ) : section === 'theme' ? (
            <ThemePanel props={props} />
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
