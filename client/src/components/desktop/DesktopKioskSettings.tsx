import React, { useState, useEffect, useCallback } from 'react';
import { Monitor, ShieldCheck, ShieldOff, AlertTriangle, CheckCircle, Info } from 'lucide-react';

interface KioskState {
  supported: boolean;
  enabled: boolean;
}

export default function DesktopKioskSettings({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<KioskState | null>(null);
  const [confirming, setConfirming] = useState<'enable' | 'disable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await (window as any).electron?.getKioskShellState?.();
      setState(result ?? { supported: false, enabled: false });
    } catch (err) {
      setState({ supported: false, enabled: false });
      setError(err instanceof Error ? err.message : 'Could not read Kiosk Mode state');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!state) return (
    <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 11 }}>Loading…</div>
  );

  if (!state.supported) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Monitor style={{ width: 14, height: 14, color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
            Kiosk Mode
          </span>
        </div>
        <div style={{
          padding: '10px 12px',
          background: 'rgba(195,204,214,0.04)',
          border: '1px solid rgba(195,204,214,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Info style={{ width: 12, height: 12, color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Kiosk Mode is only available on Windows (Panasonic Toughbook / FZ-55).
          </span>
        </div>
      </div>
    );
  }

  const applyToggle = async (enable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await (window as any).electron?.setKioskShell?.(enable);
      if (!result?.ok) {
        setError(result?.error ?? 'Failed to change Kiosk Mode');
        return;
      }
      await refresh();
      onClose();
    } catch (err) {
      setError(`Could not change Kiosk Mode — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Monitor style={{ width: 14, height: 14, color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Kiosk Mode
        </span>
      </div>

      {/* Status card */}
      <div style={{
        padding: '14px 16px',
        background: state.enabled
          ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)'
          : 'rgba(195,204,214,0.04)',
        border: `1px solid ${state.enabled ? 'rgba(62,116,168,0.3)' : 'rgba(195,204,214,0.08)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        {state.enabled
          ? <ShieldCheck style={{ width: 18, height: 18, color: 'var(--accent-silver-400)', flexShrink: 0 }} />
          : <ShieldOff style={{ width: 18, height: 18, color: 'var(--text-muted)', flexShrink: 0 }} />
        }
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            Kiosk Mode is <span style={{ color: state.enabled ? 'var(--accent-silver-400)' : 'var(--text-muted)' }}>
              {state.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            {state.enabled
              ? 'This machine boots directly into FlexOS. Windows Explorer does not load.'
              : 'This machine boots normally into Windows. FlexOS starts like a regular app.'}
          </div>
        </div>
      </div>

      {/* Escape hint when enabled */}
      {state.enabled && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(195,204,214,0.04)',
          border: '1px solid rgba(195,204,214,0.06)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}>
          <Info style={{ width: 11, height: 11, color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            To exit kiosk mode: press <strong style={{ color: 'var(--text-secondary)' }}>Ctrl+Alt+Shift+F12</strong> and
            enter an admin or manager password. A restart is required for changes to take effect.
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <AlertTriangle style={{ width: 11, height: 11, color: 'var(--sev-critical)', flexShrink: 0 }} />
          <span style={{ fontSize: 9, color: 'var(--sev-critical)' }}>{error}</span>
        </div>
      )}

      {/* Security Policies Matrix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          HARDENED KIOSK SECURITY POLICIES
        </div>

        <PolicyRow label="Shell Key Suppression (Alt+Tab, Win Key)" enabled={state.enabled} />
        <PolicyRow label="USB Storage Auto-Mount Lockout" enabled={state.enabled} />
        <PolicyRow label="Multi-Display Blackout Lock Shield" enabled={state.enabled} />
        <PolicyRow label="Renderer Self-Healing Watchdog (500ms Auto-Restart)" enabled={state.enabled} />
        <PolicyRow label="Session Sanitizer (Purge temp caches on lock)" enabled={state.enabled} />
      </div>

      {/* Confirm block */}
      {confirming ? (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertTriangle style={{ width: 13, height: 13, color: 'var(--sev-critical)', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 10, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0 }}>
              {confirming === 'enable'
                ? 'This machine will restart and boot directly into FlexOS. Windows Explorer will not load until Kiosk Mode is disabled.'
                : 'This machine will restart into the normal Windows desktop. FlexOS will no longer be the shell.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => applyToggle(confirming === 'enable')}
              style={{
                padding: '6px 14px',
                fontSize: 10,
                fontWeight: 600,
                background: confirming === 'enable' ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.8)' : 'rgba(239,68,68,0.7)',
                color: 'var(--text-primary)',
                border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {busy ? 'Applying…' : 'Yes, I understand — Restart'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              style={{
                padding: '6px 14px',
                fontSize: 10,
                background: 'rgba(195,204,214,0.06)',
                color: 'var(--text-secondary)',
                border: '1px solid rgba(195,204,214,0.1)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setConfirming(state.enabled ? 'disable' : 'enable')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              fontSize: 10,
              fontWeight: 600,
              background: state.enabled ? 'rgba(239,68,68,0.1)' : 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.15)',
              color: state.enabled ? 'var(--sev-critical)' : 'var(--accent-silver-300)',
              border: `1px solid ${state.enabled ? 'rgba(239,68,68,0.25)' : 'rgba(195,204,214,0.12)'}`,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              transition: 'background 120ms',
            }}
          >
            {state.enabled
              ? <><ShieldOff style={{ width: 12, height: 12 }} /> Disable Kiosk Mode</>
              : <><ShieldCheck style={{ width: 12, height: 12 }} /> Enable Kiosk Mode</>
            }
          </button>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            Requires admin or manager role. A system restart is required for changes to take effect.
          </p>
        </div>
      )}
    </div>
  );
}

function PolicyRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: enabled ? '#10b981' : 'var(--text-muted)' }}>
        {enabled ? 'ENFORCED' : 'OFFLINE'}
      </span>
    </div>
  );
}
