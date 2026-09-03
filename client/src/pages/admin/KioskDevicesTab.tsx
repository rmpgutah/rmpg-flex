// ============================================================
// RMPG Flex — Admin → Kiosk Devices tab (Kiosk Linux sub-project 4)
// ------------------------------------------------------------
// Device registration + fleet tracking only — no OTA update delivery.
// See docs/superpowers/specs/2026-07-23-kiosk-linux-device-registry-design.md.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Plus, Trash2, Copy } from 'lucide-react';
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
  const [newLabel, setNewLabel] = useState('');
  const [issuedToken, setIssuedToken] = useState<{ label: string; token: string } | null>(null);

  const fetchRows = useCallback(() => {
    setErr(null); setLoading(true);
    apiFetch<{ devices: DeviceRow[] }>('/kiosk-linux/devices')
      .then((r) => { setRows(r?.devices ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setErr(null); setLoading(true);
    apiFetch<{ devices: DeviceRow[] }>('/kiosk-linux/devices')
      .then((r) => { if (!cancelled) { setRows(r?.devices ?? []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const register = () => {
    const label = newLabel.trim();
    if (!label) return;
    apiFetch<{ id: string; label: string; token: string; registered_at: string }>('/kiosk-linux/devices', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
      .then((r) => { setIssuedToken({ label: r.label, token: r.token }); setNewLabel(''); fetchRows(); })
      .catch((e) => alert(`Failed to register device: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  const revoke = (id: string, label: string) => {
    if (!confirm(`Revoke device "${label}"? Its token will stop working immediately.`)) return;
    apiFetch<{ success: boolean }>(`/kiosk-linux/devices/${id}`, { method: 'DELETE' })
      .then(() => fetchRows())
      .catch((e) => alert(`Failed to revoke: ${e instanceof Error ? e.message : 'unknown'}`));
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading kiosk devices…</div>;

  return (
    <div className="p-4 space-y-3">
      {err && <div className="text-sm text-sev-critical">{err}</div>}

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
                    onClick={() => revoke(row.id, row.label)}
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
