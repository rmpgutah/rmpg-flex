// ============================================================
// RMPG Flex — Admin Security Policy Tab
// Dedicated security settings: password policy, lockout, sessions,
// IP filtering, and audit controls.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Key,
  Clock,
  Users,
  ToggleLeft,
  ToggleRight,
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Shield,
  Eye,
  Ban,
  Loader2,
  Fingerprint,
  MapPin,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface AdminSecurityTabProps {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SecurityConfig {
  // Password policy
  min_password_length: string;
  require_uppercase: string;
  require_numbers: string;
  require_special_chars: string;
  password_expiry_days: string;
  password_history_count: string;
  // Two-Factor Authentication
  totp_required_roles: string;
  // IP Session Binding
  ip_session_binding: string;
  ip_change_action: string;
  // Lockout
  max_login_attempts: string;
  lockout_duration_minutes: string;
  // Sessions
  session_timeout_minutes: string;
  max_active_sessions: string;
  force_reauth_sensitive: string;
  // Audit
  log_failed_logins: string;
  log_password_changes: string;
  log_permission_changes: string;
  // IP filtering
  ip_allowlist: string;
  ip_blocklist: string;
}

const DEFAULT_SECURITY: SecurityConfig = {
  min_password_length: '12',
  require_uppercase: '1',
  require_numbers: '1',
  require_special_chars: '1',
  password_expiry_days: '90',
  password_history_count: '5',
  totp_required_roles: '',
  ip_session_binding: '1',
  ip_change_action: 'warn',
  max_login_attempts: '5',
  lockout_duration_minutes: '15',
  session_timeout_minutes: '480',
  max_active_sessions: '5',
  force_reauth_sensitive: '0',
  log_failed_logins: '1',
  log_password_changes: '1',
  log_permission_changes: '1',
  ip_allowlist: '',
  ip_blocklist: '',
};

export default function AdminSecurityTab({ LoadingSpinner, error, setError }: AdminSecurityTabProps) {
  const [config, setConfig] = useState<SecurityConfig>({ ...DEFAULT_SECURITY });
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const result = await apiFetch<{ settings: Record<string, string> }>('/admin/system-settings');
      const s = result.settings || {};
      // Parse the security_config JSON if stored as a single JSON blob
      let secObj: Record<string, string> = {};
      if (s.security_config) {
        try { secObj = JSON.parse(s.security_config); } catch { /* */ }
      }
      // Also check for session_timeout_minutes at top level
      if (s.session_timeout_minutes) secObj.session_timeout_minutes = s.session_timeout_minutes;

      setConfig(prev => {
        const merged = { ...prev };
        for (const key of Object.keys(prev) as (keyof SecurityConfig)[]) {
          if (secObj[key] !== undefined) merged[key] = secObj[key];
        }
        return merged;
      });
    } catch { /* use defaults */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const update = (key: keyof SecurityConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const toggleBool = (key: keyof SecurityConfig) => {
    setConfig(prev => ({ ...prev, [key]: prev[key] === '1' ? '0' : '1' }));
    setDirty(true);
    setSaved(false);
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          security_config: JSON.stringify(config),
          session_timeout_minutes: config.session_timeout_minutes,
        }),
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save security settings');
    }
    setSaving(false);
  };

  if (loading) return <LoadingSpinner />;

  const ToggleButton = ({ toggleKey, label, description }: { toggleKey: keyof SecurityConfig; label: string; description?: string }) => (
    <button type="button"
      onClick={() => toggleBool(toggleKey)}
      className={`flex items-center gap-3 w-full p-3 border transition-colors text-left ${
        config[toggleKey] === '1'
          ? 'bg-green-900/20 border-green-700/50'
          : 'bg-rmpg-900 border-rmpg-600'
      }`}
    >
      {config[toggleKey] === '1' ? (
        <ToggleRight className="w-5 h-5 text-green-400 flex-shrink-0" />
      ) : (
        <ToggleLeft className="w-5 h-5 text-rmpg-500 flex-shrink-0" />
      )}
      <div>
        <span className={`text-xs font-medium ${config[toggleKey] === '1' ? 'text-green-300' : 'text-rmpg-400'}`}>{label}</span>
        {description && <p className="text-[9px] text-rmpg-500 mt-0.5">{description}</p>}
      </div>
    </button>
  );

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-red-900/30 border border-red-700/50">
            <ShieldAlert className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Security Policy</h2>
            <p className="text-[10px] text-rmpg-400">Password requirements, two-factor authentication, IP binding, lockout, sessions & audit</p>
          </div>
        </div>
        <button type="button"
          onClick={saveConfig}
          disabled={!dirty || saving}
          className={`toolbar-btn ${dirty ? 'toolbar-btn-primary' : 'toolbar-btn'} flex items-center gap-1.5`}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Save className="w-3 h-3" />}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Password Policy */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Key className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Password Policy</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Minimum Password Length</label>
            <input type="number" className="input-dark text-xs w-full" value={config.min_password_length} onChange={(e) => update('min_password_length', e.target.value)} min="6" max="32" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">Minimum characters required (6-32)</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Password Expiry (days)</label>
            <input type="number" className="input-dark text-xs w-full" value={config.password_expiry_days} onChange={(e) => update('password_expiry_days', e.target.value)} min="0" max="365" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">0 = passwords never expire</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Password History</label>
            <input type="number" className="input-dark text-xs w-full" value={config.password_history_count} onChange={(e) => update('password_history_count', e.target.value)} min="0" max="24" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">Prevent reuse of last N passwords</p>
          </div>
        </div>

        <div className="text-[10px] text-rmpg-400 uppercase font-bold border-b border-rmpg-700 pb-1 mt-4">Complexity Requirements</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ToggleButton toggleKey="require_uppercase" label="Require Uppercase" description="At least one uppercase letter" />
          <ToggleButton toggleKey="require_numbers" label="Require Numbers" description="At least one numeric digit" />
          <ToggleButton toggleKey="require_special_chars" label="Require Special Chars" description="At least one special character (!@#$...)" />
        </div>
      </div>

      {/* Two-Factor Authentication Policy */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Fingerprint className="w-4 h-4 text-green-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Two-Factor Authentication</h3>
        </div>

        <div className="p-3 bg-green-900/15 border border-green-700/40 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
          <div className="text-[10px] text-green-300/80">
            TOTP-based two-factor authentication adds a second verification step using authenticator apps (Google Authenticator, Authy, etc.). Users can enable 2FA from their profile.
          </div>
        </div>

        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Require 2FA for Roles</label>
          <input
            type="text"
            className="input-dark text-xs w-full font-mono"
            value={config.totp_required_roles}
            onChange={(e) => update('totp_required_roles', e.target.value)}
            placeholder="admin,dispatcher,supervisor (comma-separated, leave empty for optional)"
          />
          <p className="text-[9px] text-rmpg-500 mt-0.5">Users with these roles will be required to set up 2FA. Leave empty to make 2FA optional for everyone.</p>
        </div>

        <div className="p-3 bg-rmpg-800/50 border border-rmpg-600 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[9px] text-rmpg-400">
            Admins can reset a user's 2FA from the Users tab if they lose access to their authenticator app.
          </div>
        </div>
      </div>

      {/* IP Session Binding */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">IP Session Binding</h3>
        </div>

        <ToggleButton
          toggleKey="ip_session_binding"
          label="Enforce IP Session Binding"
          description="Tie active sessions to the IP address they were created from"
        />

        <div>
          <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Action on IP Change</label>
          <select
            className="input-dark text-xs w-full"
            value={config.ip_change_action}
            onChange={(e) => update('ip_change_action', e.target.value)}
          >
            <option value="warn">Warn (log but allow)</option>
            <option value="reauth">Require Re-authentication</option>
            <option value="invalidate">Invalidate Session</option>
          </select>
          <p className="text-[9px] text-rmpg-500 mt-0.5">What happens when a session is used from a different IP than it was created from</p>
        </div>
      </div>

      {/* Account Lockout */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Account Lockout</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Max Failed Login Attempts</label>
            <input type="number" className="input-dark text-xs w-full" value={config.max_login_attempts} onChange={(e) => update('max_login_attempts', e.target.value)} min="1" max="20" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">Account locks after this many failed attempts</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Lockout Duration (minutes)</label>
            <input type="number" className="input-dark text-xs w-full" value={config.lockout_duration_minutes} onChange={(e) => update('lockout_duration_minutes', e.target.value)} min="1" max="1440" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">How long the account stays locked</p>
          </div>
        </div>

        <div className="p-3 bg-amber-900/15 border border-amber-700/40 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-300/80">
            Locked accounts can be manually unlocked by an admin from the Users tab. Failed login attempts are logged in the Audit Trail.
          </div>
        </div>
      </div>

      {/* Session Management */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Session Management</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Session Timeout (minutes)</label>
            <input type="number" className="input-dark text-xs w-full" value={config.session_timeout_minutes} onChange={(e) => update('session_timeout_minutes', e.target.value)} min="5" max="1440" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">Auto-logout after inactivity. Current: {Math.round(Number(config.session_timeout_minutes) / 60)}h {Number(config.session_timeout_minutes) % 60}m</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">Max Concurrent Sessions</label>
            <input type="number" className="input-dark text-xs w-full" value={config.max_active_sessions} onChange={(e) => update('max_active_sessions', e.target.value)} min="1" max="10" />
            <p className="text-[9px] text-rmpg-500 mt-0.5">Maximum simultaneous logins per user</p>
          </div>
        </div>

        <ToggleButton
          toggleKey="force_reauth_sensitive"
          label="Require Re-authentication for Sensitive Actions"
          description="Force password re-entry for record deletions, user management, and credential changes"
        />
      </div>

      {/* Audit Logging */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4 text-purple-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Audit Logging</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ToggleButton toggleKey="log_failed_logins" label="Log Failed Logins" description="Track authentication failures" />
          <ToggleButton toggleKey="log_password_changes" label="Log Password Changes" description="Track when passwords are modified" />
          <ToggleButton toggleKey="log_permission_changes" label="Log Permission Changes" description="Track role and access modifications" />
        </div>
      </div>

      {/* IP Filtering */}
      <div className="panel-beveled p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Ban className="w-4 h-4 text-red-400" />
          <h3 className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">IP Access Control</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">IP Allowlist</label>
            <textarea
              className="input-dark text-xs w-full h-20 font-mono"
              value={config.ip_allowlist}
              onChange={(e) => update('ip_allowlist', e.target.value)}
              placeholder="One IP per line (leave empty to allow all)&#10;192.168.1.0/24&#10;10.0.0.1"
            />
            <p className="text-[9px] text-rmpg-500 mt-0.5">If set, only these IPs can access the system</p>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase block mb-1">IP Blocklist</label>
            <textarea
              className="input-dark text-xs w-full h-20 font-mono"
              value={config.ip_blocklist}
              onChange={(e) => update('ip_blocklist', e.target.value)}
              placeholder="One IP per line&#10;203.0.113.50"
            />
            <p className="text-[9px] text-rmpg-500 mt-0.5">These IPs are always denied access</p>
          </div>
        </div>

        <div className="p-3 bg-rmpg-800/50 border border-rmpg-600 flex items-start gap-2">
          <Shield className="w-4 h-4 text-rmpg-400 flex-shrink-0 mt-0.5" />
          <div className="text-[9px] text-rmpg-400">
            IP filtering is enforced at the server level. CIDR notation is supported (e.g., 192.168.1.0/24). The blocklist takes priority over the allowlist.
          </div>
        </div>
      </div>

      {/* Save footer */}
      {dirty && (
        <div className="sticky bottom-0 bg-rmpg-950/90 backdrop-blur-sm border-t border-rmpg-700 p-3 flex items-center justify-between -mx-4 px-4">
          <span className="text-[10px] text-amber-400">You have unsaved changes</span>
          <button type="button" onClick={saveConfig} disabled={saving} className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
