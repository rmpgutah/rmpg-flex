import { useState, useEffect, useCallback } from 'react';
import { Monitor, Smartphone, Tablet, Globe, Trash2, RefreshCw, Shield } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { TrustedDevice } from '../../types';

function deviceIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('android'))
    return <Smartphone className="w-3.5 h-3.5" />;
  if (lower.includes('tablet') || lower.includes('ipad'))
    return <Tablet className="w-3.5 h-3.5" />;
  if (lower.includes('chrome') || lower.includes('firefox') || lower.includes('safari') || lower.includes('edge'))
    return <Monitor className="w-3.5 h-3.5" />;
  return <Globe className="w-3.5 h-3.5" />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days <= 0) return 'Expired';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function TrustedDevicesList() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<number | null>(null);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/security/trusted-devices', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setDevices(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const revokeDevice = async (id: number) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/auth/security/trusted-devices/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (res.ok) setDevices(prev => prev.filter(d => d.id !== id));
    } catch { /* ignore */ }
    setRevoking(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: '#666666' }} />
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="text-center py-6">
        <Shield className="w-6 h-6 mx-auto mb-2" style={{ color: '#2e2e2e' }} />
        <p className="text-[10px]" style={{ color: '#666666' }}>No trusted devices</p>
        <p className="text-[9px] mt-1" style={{ color: '#555555' }}>
          Trust a device during login to skip 2FA for 30 days
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {devices.map(device => (
        <div
          key={device.id}
          className="flex items-center gap-3 px-3 py-2 panel-beveled"
          style={{ background: '#0a0a0a' }}
        >
          {/* Device icon */}
          <div className="p-1.5 panel-inset" style={{ color: '#888888', background: 'rgba(74,144,196,0.1)' }}>
            {deviceIcon(device.device_name)}
          </div>

          {/* Device info */}
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold truncate" style={{ color: '#e0e0e0' }}>
              {device.device_name}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[9px] font-mono" style={{ color: '#666666' }}>
                {device.ip_address}
              </span>
              <span className="text-[9px]" style={{ color: '#555555' }}>
                Last used {timeAgo(device.last_used_at)}
              </span>
            </div>
          </div>

          {/* Expiry */}
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] font-mono" style={{ color: '#888888' }}>
              {daysUntil(device.trusted_until)} left
            </div>
          </div>

          {/* Revoke button */}
          <button type="button"
            onClick={() => revokeDevice(device.id)}
            disabled={revoking === device.id}
            className="toolbar-btn flex items-center gap-1 text-[9px]"
            style={{ color: revoking === device.id ? '#555555' : '#ef4444' }}
            title="Revoke trust"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      <div className="text-[9px] pt-1" style={{ color: '#555555' }}>
        {devices.length} trusted device{devices.length !== 1 ? 's' : ''} — revoking a device will require 2FA on next login from it
      </div>
    </div>
  );
}
