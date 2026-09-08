import React, { useState, useRef, useCallback, useMemo } from 'react';
import { X, LayoutGrid, Palette, Accessibility, AppWindow, Settings, Upload, Check } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import type { DesktopSettingsAppProps } from '../DesktopSettingsApp';
import DesktopSettingsApp from '../DesktopSettingsApp';
import { apiHttpBase } from '../../../utils/apiOrigin';
import SettingsPanel from '../settings/SettingsPanel';
import type { ExtraSettingsTab } from '../settings/SettingsPanel';

const W = 980;
const H = 660;

// Desktop-shell-only sections (wallpaper, icons, theme, window rules,
// accessibility) are injected into SettingsPanel as extra tabs; everything
// hardware-facing (Display, Sound, Network, …) lives in SettingsPanel itself.
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
      const res = await fetch(`${apiHttpBase()}/api/preferences/wallpaper`, {
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

type Props = DesktopSettingsAppProps;

export default function DesktopSystemPreferences(props: Props) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : W;
  const vh = typeof window !== 'undefined' ? window.innerHeight : H;
  const width = Math.min(W, Math.max(640, vw - 40));
  const height = Math.min(H, Math.max(420, vh - 80));
  const [pos, setPos] = useState({ x: Math.max(0, (vw - width) / 2), y: Math.max(0, (vh - height) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));

  const extraTabs = useMemo<ExtraSettingsTab[]>(() => [
    { id: 'desktop',       label: 'Desktop & Icons', icon: LayoutGrid,    group: 'Desktop', render: () => <DesktopSettingsApp {...props} /> },
    { id: 'theme',         label: 'Theme',           icon: Palette,       group: 'Desktop', render: () => <ThemePanel props={props} /> },
    { id: 'window-rules',  label: 'Window Rules',    icon: AppWindow,     group: 'Desktop', render: () => <DesktopSettingsApp {...props} /> },
    { id: 'accessibility', label: 'Accessibility',   icon: Accessibility, group: 'Desktop', render: () => <AccessibilityPanel /> },
  ], [props]);

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width, height,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px var(--window-shadow)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <Settings size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Settings</span>
        <button aria-label="Close System Preferences" onClick={props.onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <SettingsPanel initialTab="desktop" extraTabs={extraTabs} />
      </div>
    </div>
  );
}
