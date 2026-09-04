// ============================================================
// SecurityKeyManager — Register and manage WebAuthn security keys
// Used in the Security settings panel for adding/removing YubiKeys,
// Touch ID, Windows Hello, etc.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { parseTimestamp } from '../../utils/dateUtils';
import { Usb, Plus, Trash2, RefreshCw, Shield, Fingerprint } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { importWithRetry } from '../../utils/importWithRetry';

interface WebAuthnCredential {
  id: number;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - parseTimestamp(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return parseTimestamp(dateStr).toLocaleDateString('en-US', { timeZone: 'America/Denver' });
}

function transportLabel(transports: string[]): string {
  if (transports.includes('usb')) return 'USB';
  if (transports.includes('nfc')) return 'NFC';
  if (transports.includes('ble')) return 'Bluetooth';
  if (transports.includes('internal')) return 'Built-in';
  return 'Unknown';
}

export default function SecurityKeyManager() {
  const { token } = useAuth();
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/webauthn/credentials', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCredentials(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const handleRegister = async () => {
    setRegistering(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Get registration options
      const optionsRes = await fetch('/api/auth/webauthn/register-options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!optionsRes.ok) {
        const errData = await optionsRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to get registration options');
      }

      const { options, challengeId } = await optionsRes.json();

      // 2. Prompt browser WebAuthn dialog
      const { startRegistration } = await importWithRetry(() => import('@simplewebauthn/browser'));
      const regResponse = await startRegistration({ optionsJSON: options });

      // 3. Verify with server
      const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          challengeId,
          response: regResponse,
          name: newKeyName.trim() || 'Security Key',
        }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Registration failed');
      }

      setSuccess('Security key registered successfully');
      setNewKeyName('');
      setShowNameInput(false);
      fetchCredentials();
    } catch (err) {
      const webAuthnErr = err as { name?: string; code?: string };
      if (webAuthnErr.name === 'NotAllowedError') {
        setError('Registration was cancelled or timed out. Please try again.');
      } else if (webAuthnErr.name === 'InvalidStateError' || webAuthnErr.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
        setError('This security key is already registered. Use a different key.');
      } else if (webAuthnErr.name === 'SecurityError') {
        setError('Security key registration is not available on this domain.');
      } else if (webAuthnErr.name === 'NotSupportedError') {
        setError('This security key is not supported by your browser.');
      } else if (err instanceof Error && err.message.includes('not supported')) {
        setError('WebAuthn is not supported in this browser. Use a modern browser like Chrome or Safari.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to register security key');
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRevoke = async (id: number) => {
    setRevoking(id);
    setError(null);
    try {
      const res = await fetch(`/api/auth/webauthn/credentials/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (res.ok) {
        setCredentials(prev => prev.filter(c => c.id !== id));
        setSuccess('Security key removed');
      } else {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to remove key');
      }
    } catch {
      setError('Failed to remove security key');
    }
    setRevoking(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <RefreshCw className="w-4 h-4 animate-spin text-fg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Usb className="w-3.5 h-3.5 text-amber-600" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
            Security Keys ({credentials.length})
          </span>
        </div>
      </div>

      {/* Feedback messages */}
      {error && (
        <div className="text-[10px] px-2 py-1.5 text-red-300 bg-red-500/10 border border-red-500/20">
          {error}
        </div>
      )}
      {success && (
        <div className="text-[10px] px-2 py-1.5 text-green-300 bg-green-500/10 border border-green-500/20">
          {success}
        </div>
      )}

      {/* Credentials list */}
      {credentials.length > 0 ? (
        <div className="space-y-1.5">
          {credentials.map(cred => (
            <div
              key={cred.id}
              className="flex items-center gap-3 px-3 py-2 panel-beveled"
              style={{ background:"var(--surface-sunken)" }}
            >
              <div className="p-1.5 panel-inset text-amber-600 bg-amber-600/10">
                {cred.deviceType === 'multiDevice' ? (
                  <Fingerprint className="w-3.5 h-3.5" />
                ) : (
                  <Usb className="w-3.5 h-3.5" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold truncate text-rmpg-300">
                  {cred.name}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[9px] font-mono text-fg-muted">
                    {transportLabel(cred.transports)}
                  </span>
                  <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                    Last used {timeAgo(cred.lastUsedAt)}
                  </span>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <div className="text-[9px] font-mono text-fg-muted">
                  Added {cred.createdAt ? parseTimestamp(cred.createdAt).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : 'N/A'}
                </div>
              </div>

              <button type="button"
                onClick={() => handleRevoke(cred.id)}
                disabled={revoking === cred.id}
                className={`toolbar-btn flex items-center gap-1 text-[9px] ${revoking === cred.id ? 'text-fg-muted' : 'text-red-500'}`}
                title="Remove key"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4">
          <Shield className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
          <p className="text-[10px] text-fg-muted">No security keys registered</p>
          <p className="text-[9px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Register a YubiKey, Touch ID, or Windows Hello to use as 2FA
          </p>
        </div>
      )}

      {/* Register new key */}
      {showNameInput ? (
        <div className="flex items-center gap-2">
          <input id="ff-securitykeymanager-0"
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key name (e.g., My YubiKey)"
            className="input-dark flex-1 h-8 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRegister();
              if (e.key === 'Escape') {
                setShowNameInput(false);
                setNewKeyName('');
              }
            }}
          />
          <button type="button"
            onClick={handleRegister}
            disabled={registering}
            className="toolbar-btn toolbar-btn-primary h-8 px-3 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1"
          >
            {registering ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Usb className="w-3 h-3" />
            )}
            {registering ? 'Tap Key...' : 'Register'}
          </button>
          <button type="button"
            onClick={() => {
              setShowNameInput(false);
              setNewKeyName('');
            }}
                        className="toolbar-btn h-8 px-2 text-[10px] text-fg-muted"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button type="button"
          onClick={() => setShowNameInput(true)}
          className="toolbar-btn w-full h-8 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 border-amber-600"
        >
          <Plus className="w-3 h-3" />
          Register Security Key
        </button>
      )}

      <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
        Supports YubiKey, Touch ID, Windows Hello, and other FIDO2-compatible keys
      </p>
    </div>
  );
}
