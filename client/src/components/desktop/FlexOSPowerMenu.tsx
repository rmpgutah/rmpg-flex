/**
 * FlexOS Power Menu
 *
 * Shown on Ctrl+Alt+Delete (or from taskbar right-click). Full-screen dimmed
 * overlay with Lock, Sign Out, Restart App, and — on Windows — Shut Down,
 * Restart, and (kiosk mode only) Return to Windows.
 */
import React, { useEffect, useState } from 'react';
import { Lock, LogOut, RefreshCw, X, Shield, Power, RotateCcw, Monitor } from 'lucide-react';

export interface FlexOSPowerMenuProps {
  onClose: () => void;
  onLock: () => void;
  onSignOut: () => void;
}

type View = 'menu' | 'return-to-windows';

interface RtwState {
  username: string;
  password: string;
  error: string;
  loading: boolean;
}

export default function FlexOSPowerMenu({ onClose, onLock, onSignOut }: FlexOSPowerMenuProps) {
  const el = (window as any).electron;
  const isWin = el?.platform === 'win32';

  const [kioskActive, setKioskActive] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [rtw, setRtw] = useState<RtwState>({ username: '', password: '', error: '', loading: false });

  // Load kiosk state once on mount — determines whether Return to Windows is shown.
  useEffect(() => {
    el?.getKioskShellState?.()
      .then((s: { supported: boolean; enabled: boolean }) => setKioskActive(Boolean(s?.enabled)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape key: back to menu from sub-panel; close overlay from main menu.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'return-to-windows') { setView('menu'); } else { onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, view]);

  const handleRestartApp = () => {
    if (el?.isElectron && el?.restartApp) { el.restartApp(); } else { window.location.reload(); }
    onClose();
  };

  const handleShutdown = () => { el?.shutdownOs?.(); };
  const handleRestartOs = () => { el?.restartOs?.(); };

  const handleReturnToWindows = async () => {
    if (rtw.loading) return;
    setRtw(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const result = await el?.returnToWindows?.(rtw.username, rtw.password);
      if (result?.ok) {
        // Main process shows a sync dialog then the OS begins shutting down.
        // Keep loading state — the operator will see the native dialog next.
      } else {
        setRtw(prev => ({ ...prev, loading: false, error: result?.error || 'An error occurred.' }));
      }
    } catch {
      setRtw(prev => ({ ...prev, loading: false, error: 'Could not reach the app.' }));
    }
  };

  const OVERLAY: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 9995,
    background: 'var(--modal-scrim)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  };

  const CARD: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
    minWidth: 280,
  };

  if (view === 'return-to-windows') {
    return (
      <div style={OVERLAY} onClick={onClose}>
        <div style={CARD} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <Monitor style={{ width: 16, height: 16, color: 'var(--accent-silver-400)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Return to Windows
            </span>
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, textAlign: 'center' }}>
            Admin or manager credentials required.
          </p>

          <input
            type="text"
            placeholder="Username"
            value={rtw.username}
            onChange={e => setRtw(prev => ({ ...prev, username: e.target.value }))}
            autoComplete="username"
            disabled={rtw.loading}
            style={{
              padding: '8px 10px',
              marginBottom: 8,
              background: 'rgba(var(--rmpg-800-rgb, 18 40 64), 0.9)',
              border: '1px solid rgba(195,204,214,0.2)',
              color: 'var(--text-primary)',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={rtw.password}
            onChange={e => setRtw(prev => ({ ...prev, password: e.target.value }))}
            autoComplete="current-password"
            disabled={rtw.loading}
            onKeyDown={e => { if (e.key === 'Enter' && !rtw.loading) handleReturnToWindows(); }}
            style={{
              padding: '8px 10px',
              marginBottom: 8,
              background: 'rgba(var(--rmpg-800-rgb, 18 40 64), 0.9)',
              border: '1px solid rgba(195,204,214,0.2)',
              color: 'var(--text-primary)',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box',
            }}
          />

          {rtw.error && (
            <p style={{ fontSize: 11, color: 'var(--sev-critical, #ef4444)', marginBottom: 8, width: '100%' }}>
              {rtw.error}
            </p>
          )}

          <button
            type="button"
            onClick={handleReturnToWindows}
            disabled={rtw.loading || !rtw.username || !rtw.password}
            style={{
              padding: '12px 20px',
              background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.7)',
              border: '1px solid rgba(195,204,214,0.12)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: rtw.loading || !rtw.username || !rtw.password ? 'not-allowed' : 'pointer',
              width: '100%',
              opacity: rtw.loading || !rtw.username || !rtw.password ? 0.5 : 1,
            }}
          >
            {rtw.loading ? 'Verifying…' : 'Return to Windows'}
          </button>

          <button
            type="button"
            onClick={() => setView('menu')}
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 16px',
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            <X style={{ width: 11, height: 11 }} />
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={CARD} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <Shield style={{ width: 16, height: 16, color: 'var(--accent-silver-400)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            FlexOS
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <PowerButton icon={Lock} label="Lock" sublabel="Ctrl+L" onClick={() => { onLock(); onClose(); }} />
          <PowerButton icon={LogOut} label="Sign Out" sublabel="End session" onClick={() => { onSignOut(); onClose(); }} />
          <PowerButton icon={RefreshCw} label="Restart App" sublabel="Reload FlexOS" onClick={handleRestartApp} />

          {isWin && (
            <>
              <div style={{ height: 1, background: 'rgba(195,204,214,0.12)', margin: '4px 0' }} />
              <PowerButton icon={Power} label="Shut Down" sublabel="Shut down this computer" onClick={handleShutdown} />
              <PowerButton icon={RotateCcw} label="Restart" sublabel="Restart this computer" onClick={handleRestartOs} />
              {kioskActive && (
                <PowerButton
                  icon={Monitor}
                  label="Return to Windows"
                  sublabel="Requires admin credentials"
                  onClick={() => setView('return-to-windows')}
                />
              )}
            </>
          )}
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
            color: 'var(--text-muted)',
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

function PowerButton({
  icon: Icon,
  label,
  sublabel,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
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
      <Icon style={{ width: 18, height: 18, color: 'var(--accent-silver-300)', flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, letterSpacing: '0.04em' }}>{sublabel}</div>
      </div>
    </button>
  );
}
