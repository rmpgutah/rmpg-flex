/**
 * FlexOS Power Menu
 *
 * Shown on Ctrl+Alt+Delete (or from taskbar right-click). Full-screen dimmed
 * overlay with Lock, Sign Out, and Restart App actions — the OS-level session
 * controls that belong outside the regular settings app.
 */
import React, { useEffect } from 'react';
import { Lock, LogOut, RefreshCw, X, Shield } from 'lucide-react';

export interface FlexOSPowerMenuProps {
  onClose: () => void;
  onLock: () => void;
  onSignOut: () => void;
}

export default function FlexOSPowerMenu({ onClose, onLock, onSignOut }: FlexOSPowerMenuProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleRestartApp = () => {
    const el = (window as any).electron;
    if (el?.isElectron && el?.restartApp) { el.restartApp(); } else { window.location.reload(); }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9995, // above desktop, below lock screen
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          minWidth: 280,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <Shield style={{ width: 16, height: 16, color: 'var(--accent-silver-400, #c3ccd6)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            FlexOS
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <PowerButton icon={Lock} label="Lock" sublabel="Ctrl+L" onClick={() => { onLock(); onClose(); }} />
          <PowerButton icon={LogOut} label="Sign Out" sublabel="End session" onClick={() => { onSignOut(); onClose(); }} />
          <PowerButton icon={RefreshCw} label="Restart App" sublabel="Reload FlexOS" onClick={handleRestartApp} />
        </div>

        {/* Cancel */}
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 16px',
            fontSize: 10,
            color: 'var(--text-muted, #8da0b3)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            letterSpacing: '0.04em',
          }}
        >
          <X style={{ width: 11, height: 11 }} />
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}

function PowerButton({ icon: Icon, label, sublabel, onClick }: { icon: React.ElementType; label: string; sublabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)',
        border: '1px solid rgba(195,204,214,0.12)',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        transition: 'background 120ms',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.4)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)'; }}
    >
      <Icon style={{ width: 18, height: 18, color: 'var(--accent-silver-300, #d4dde6)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)' }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', marginTop: 2, letterSpacing: '0.04em' }}>{sublabel}</div>
      </div>
    </button>
  );
}
