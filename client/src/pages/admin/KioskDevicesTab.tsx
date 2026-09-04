// ============================================================
// RMPG Flex — Admin → Kiosk Devices tab (Kiosk Linux sub-project 4)
// ------------------------------------------------------------
// Device registration + fleet tracking only — no OTA update delivery.
// See docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus, Trash2, Copy, AlertTriangle } from 'lucide-react';
import { formatEnumValue } from '../../utils/formatters';

interface DeviceRow {
  id: string;
  label: string;
  os_version: string | null;
  status: 'active' | 'revoked';
  registered_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
}

export default function KioskDevicesTab() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mutationErr, setMutationErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null);
  // id of device pending revoke confirmation; null = no dialog open
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; label: string } | null>(null);

  const fetchRows = useCallback(() => {
    setErr(null);
    setLoading(true);
    apiFetch<{ devices: DeviceRow[] }>('/kiosk-linux/devices')
      .then((r) => { setRows(r?.devices ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const register = () => {
    const label = newLabel.trim();
    if (!label) return;
    setMutationErr(null);
    apiFetch<{ id: string; label: string; token: string; registered_at: string }>('/kiosk-linux/devices', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
      .then((r) => {
        // Guard: not_configured or malformed response
        if (!r?.token || !r?.label) {
          setMutationErr('Device registration failed — server did not return a token.');
          return;
        }
        setIssuedToken({ label: r.label, token: r.token });
        setNewLabel('');
        fetchRows();
      })
      .catch((e) => setMutationErr(`Failed to register device: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  const confirmRevoke = () => {
    if (!pendingRevoke) return;
    const { id } = pendingRevoke;
    setPendingRevoke(null);
    setMutationErr(null);
    apiFetch<{ success: boolean }>(`/kiosk-linux/devices/${id}`, { method: 'DELETE' })
      .then(() => fetchRows())
      .catch((e) => setMutationErr(`Failed to revoke: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading kiosk devices…</div>;

  return (
    <div className="p-4 space-y-3">
      {err && <div className="text-sm text-sev-critical">{err}</div>}

      {mutationErr && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 text-sev-critical text-xs">
          <AlertTriangle size={12} className="flex-shrink-0" />
          <span>{mutationErr}</span>
        </div>
      )}

      {/* Inline confirm dialog — replaces window.confirm() which is blocked in Electron */}
      {pendingRevoke && (
        <div className="flex items-start gap-3 px-3 py-3 bg-surface-raised border border-sev-critical/30">
          <AlertTriangle size={14} className="flex-shrink-0 text-sev-critical mt-0.5" />
          <div className="flex-1 space-y-2">
            <p className="text-xs text-text-primary">
              Revoke device <strong>"{pendingRevoke.label}"</strong>? Its token will stop working immediately.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmRevoke}
                className="text-xs px-3 py-1 bg-red-600/80 text-white font-semibold"
              >
                Revoke
              </button>
              <button
                type="button"
                onClick={() => setPendingRevoke(null)}
                className="text-xs px-3 py-1 bg-surface-overlay text-text-secondary border border-border-subtle"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {issuedToken && (
        <div className="bg-surface-raised border border-brand-400 p-3 rounded-none space-y-2">
          <p className="text-sm font-semibold text-text-primary">
            Device "{issuedToken.label}" registered. Copy its token now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-surface-base px-2 py-1 flex-1 break-all">{issuedToken.token}</code>
            <button
              type="button"
              aria-label="Copy device token"
              onClick={() => navigator.clipboard.writeText(issuedToken.token)}
              className="p-1"
            >
              <Copy size={14} />
            </button>
          </div>
          <button
            type="button"
            className="text-xs text-brand-400 underline"
            onClick={() => setIssuedToken(null)}
          >
            I have saved this token
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') register(); }}
          placeholder="Device label, e.g. Lobby kiosk 1"
          className="text-sm bg-surface-raised border border-rmpg-700 px-2 py-1 flex-1"
        />
        <button
          type="button"
          onClick={register}
          className="flex items-center gap-1 text-sm bg-brand-500 text-surface-base px-3 py-1"
        >
          <Plus size={14} /> Register device
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left font-semibold" style={{ fontSize: '9px' }}>
            <th className="py-[3px]">Label</th>
            <th className="py-[3px]">Status</th>
            <th className="py-[3px]">OS version</th>
            <th className="py-[3px]">Last seen</th>
            <th className="py-[3px]"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ fontSize: '11px' }}>
              <td className="py-[2px]">{row.label}</td>
              <td className="py-[2px]">{formatEnumValue(row.status)}</td>
              <td className="py-[2px]">{row.os_version ?? '—'}</td>
              <td className="py-[2px]">{row.last_seen_at ?? 'never'}</td>
              <td className="py-[2px]">
                {row.status === 'active' && (
                  <button
                    type="button"
                    aria-label={`Revoke ${row.label}`}
                    onClick={() => setPendingRevoke({ id: row.id, label: row.label })}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-2 text-rmpg-400">No devices registered yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
