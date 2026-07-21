import React, { useState, useEffect, useCallback } from 'react';

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
      const result = await window.electron?.getKioskShellState?.();
      setState(result ?? { supported: false, enabled: false });
    } catch (err) {
      setState({ supported: false, enabled: false });
      setError(err instanceof Error ? err.message : 'Could not read Kiosk Mode state');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!state) return null;

  if (!state.supported) {
    return (
      <div className="p-4 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Kiosk Mode is only available on Windows.
      </div>
    );
  }

  const applyToggle = async (enable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.electron?.setKioskShell?.(enable);
      if (!result?.ok) {
        setError(result?.error ?? 'Failed to change Kiosk Mode');
        return;
      }
      await refresh();
      // Close the whole Settings app after a successful change — a restart
      // prompt (enable) or restart instruction (disable) is about to be
      // shown by the main process, so leaving Settings open behind it serves
      // no purpose.
      onClose();
    } catch (err) {
      setError(`Could not change Kiosk Mode — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div className="p-4 space-y-4 text-[11px]" style={{ color: 'var(--text-primary)' }}>
      <div>
        Kiosk Mode: <span className="font-semibold">{state.enabled ? 'On' : 'Off'}</span>
        {state.enabled && (
          <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
            This machine boots directly into RMPG Flex. Press Ctrl+Alt+Shift+F12 and enter an
            admin or manager password to exit.
          </p>
        )}
      </div>

      {error && <div style={{ color: 'var(--sev-critical, var(--rmpg-400))' }}>{error}</div>}

      {confirming ? (
        <div className="space-y-2 p-3 border border-rmpg-700">
          <p>
            {confirming === 'enable'
              ? 'This machine will restart and boot directly into RMPG Flex — Windows Explorer will no longer load normally. Press Ctrl+Alt+Shift+F12 and enter an admin/manager password to exit.'
              : 'This machine will restart into the normal Windows desktop.'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 bg-brand-400 text-surface-base"
              disabled={busy}
              onClick={() => applyToggle(confirming === 'enable')}
            >
              Yes, I understand
            </button>
            <button
              type="button"
              className="px-3 py-1 border border-rmpg-700"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="px-3 py-1 bg-brand-400 text-surface-base"
          onClick={() => setConfirming(state.enabled ? 'disable' : 'enable')}
        >
          {state.enabled ? 'Disable Kiosk Mode' : 'Enable Kiosk Mode'}
        </button>
      )}
    </div>
  );
}
