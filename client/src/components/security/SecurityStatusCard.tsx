import { useState, useEffect, useCallback } from 'react';
import { Shield, Key, Monitor, Clock, Bell, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { SecurityStatus } from '../../types';

interface StatusItem {
  icon: React.ReactNode;
  label: string;
  value: string;
  led: string;  // led-green, led-amber, led-red, led-off
  detail?: string;
}

function ledClass(status: string): string {
  return `led-dot ${status}`;
}

export default function SecurityStatusCard() {
  const { token } = useAuth();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/security/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (loading) {
    return (
      <div className="panel-beveled p-4 flex items-center justify-center" style={{ background: '#141e2b' }}>
        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: '#6b7280' }} />
      </div>
    );
  }

  if (!status) return null;

  const items: StatusItem[] = [
    {
      icon: <Shield className="w-3.5 h-3.5" />,
      label: '2FA Status',
      value: status.totpEnabled ? 'Enabled' : status.totpSetupRequired ? 'Setup Required' : 'Disabled',
      led: status.totpEnabled ? 'led-green' : 'led-red',
    },
    {
      icon: <Key className="w-3.5 h-3.5" />,
      label: 'Backup Codes',
      value: `${status.backupCodesRemaining ?? 0} remaining`,
      led: (status.backupCodesRemaining ?? 0) >= 5 ? 'led-green'
        : (status.backupCodesRemaining ?? 0) >= 2 ? 'led-amber'
        : (status.backupCodesRemaining ?? 0) > 0 ? 'led-red'
        : 'led-off',
      detail: (status.backupCodesRemaining ?? 0) <= 2 ? 'Regenerate soon' : undefined,
    },
    {
      icon: <Monitor className="w-3.5 h-3.5" />,
      label: 'Active Sessions',
      value: `${status.activeSessions} session${status.activeSessions !== 1 ? 's' : ''}`,
      led: status.activeSessions <= 3 ? 'led-green' : 'led-amber',
    },
    {
      icon: <Monitor className="w-3.5 h-3.5" />,
      label: 'Trusted Devices',
      value: `${status.trustedDevices} device${status.trustedDevices !== 1 ? 's' : ''}`,
      led: status.trustedDevices > 0 ? 'led-blue' : 'led-off',
    },
    {
      icon: <Clock className="w-3.5 h-3.5" />,
      label: 'Password',
      value: status.passwordExpired ? 'Expired' :
        status.passwordExpiringSoon ? 'Expiring Soon' :
        status.passwordExpiresAt ? `Expires ${formatExpiry(status.passwordExpiresAt)}` : 'No Expiry',
      led: status.passwordExpired ? 'led-red' :
        status.passwordExpiringSoon ? 'led-amber' : 'led-green',
    },
    {
      icon: <Bell className="w-3.5 h-3.5" />,
      label: 'Notifications',
      value: status.unreadSecurityNotifications > 0
        ? `${status.unreadSecurityNotifications} unread`
        : 'All read',
      led: status.unreadSecurityNotifications > 0 ? 'led-amber' : 'led-green',
    },
  ];

  // Overall score
  const score = computeScore(status);

  return (
    <div className="panel-beveled" style={{ background: '#141e2b' }}>
      {/* Header */}
      <div className="panel-title-bar flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="title-icon w-3 h-3" />
          <span>Security Overview</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={ledClass(score.led)} />
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: score.color }}
          >
            {score.label}
          </span>
        </div>
      </div>

      {/* Warning banner if critical */}
      {score.warning && (
        <div
          className="flex items-start gap-2 px-3 py-2"
          style={{ background: 'rgba(239, 68, 68, 0.08)', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#ef4444' }} />
          <span className="text-[10px]" style={{ color: '#fca5a5' }}>{score.warning}</span>
        </div>
      )}

      {/* Status items */}
      <div className="divide-y" style={{ borderColor: '#1e3048' }}>
        {items.map(item => (
          <div key={item.label} className="flex items-center gap-3 px-3 py-2">
            <span className={ledClass(item.led)} />
            <div className="flex-shrink-0" style={{ color: '#6b7280' }}>
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8a9aaa' }}>
                {item.label}
              </span>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-[11px] font-mono" style={{ color: '#e5e7eb' }}>
                {item.value}
              </span>
              {item.detail && (
                <div className="text-[9px]" style={{ color: '#d4a017' }}>{item.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Last password change footer */}
      {status.passwordChangedAt && (
        <div
          className="px-3 py-1.5 text-[9px] font-mono"
          style={{ borderTop: '1px solid #1e3048', color: '#4b5563' }}
        >
          Password last changed: {status.passwordChangedAt ? new Date(status.passwordChangedAt).toLocaleDateString() : 'N/A'}
        </div>
      )}
    </div>
  );
}

function formatExpiry(dateStr: string): string {
  const d = new Date(dateStr);
  const diff = d.getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return `in ${days} days`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function computeScore(s: SecurityStatus): { label: string; led: string; color: string; warning?: string } {
  if (s.passwordExpired) {
    return { label: 'Critical', led: 'led-red', color: '#ef4444', warning: 'Your password has expired. Change it immediately.' };
  }
  if (!s.totpEnabled && !s.totpSetupRequired) {
    return { label: 'At Risk', led: 'led-red', color: '#ef4444', warning: 'Two-factor authentication is not configured.' };
  }
  if (s.backupCodesRemaining === 0) {
    return { label: 'Warning', led: 'led-amber', color: '#f59e0b', warning: 'No backup codes remaining. Regenerate them now.' };
  }
  if (s.passwordExpiringSoon || (s.backupCodesRemaining ?? 0) <= 2) {
    return { label: 'Attention', led: 'led-amber', color: '#f59e0b' };
  }
  if (s.totpEnabled && (s.backupCodesRemaining ?? 0) >= 5) {
    return { label: 'Secure', led: 'led-green', color: '#22c55e' };
  }
  return { label: 'Good', led: 'led-green', color: '#22c55e' };
}
