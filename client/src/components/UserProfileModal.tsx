import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Lock,
  Save,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Shield,
  Key,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import SecurityStatusCard from './security/SecurityStatusCard';
import TwoFactorSetupWizard from './security/TwoFactorSetupWizard';
import TrustedDevicesList from './security/TrustedDevicesList';
import LoginHistoryTable from './security/LoginHistoryTable';
import BackupCodesDisplay from './security/BackupCodesDisplay';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'profile' | 'password' | 'sessions' | 'security';
}

export default function UserProfileModal({ isOpen, onClose, initialTab = 'profile' }: UserProfileModalProps) {
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Profile form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pwPolicy, setPwPolicy] = useState<string[]>([]);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);

  // Security tab state
  const [securityView, setSecurityView] = useState<'overview' | 'setup-2fa' | 'regen-backup' | 'devices' | 'history'>('overview');
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState('');

  useEffect(() => {
    if (isOpen && user) {
      setFirstName(user.first_name || '');
      setLastName(user.last_name || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      setActiveTab(initialTab);
      setProfileMsg(null);
      setPwMsg(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [isOpen, user, initialTab]);

  useEffect(() => {
    if (isOpen && activeTab === 'password') {
      apiFetch<any>('/auth/password-policy')
        .then(data => setPwPolicy(Array.isArray(data?.policy) ? data.policy : []))
        .catch(() => {});
    }
    if (isOpen && activeTab === 'sessions') {
      apiFetch<any>('/auth/sessions')
        .then(data => setSessions(Array.isArray(data) ? data : []))
        .catch(() => setSessions([]));
    }
    if (isOpen && activeTab === 'security') {
      apiFetch<any>('/auth/2fa/status')
        .then(data => setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }))
        .catch(() => {});
      setSecurityView('overview');
      setRegenCodes(null);
      setRegenPassword('');
      setRegenError('');
    }
  }, [isOpen, activeTab]);

  if (!isOpen || !user) return null;

  const handleProfileSave = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ first_name: firstName, last_name: lastName, email, phone }),
      });
      // Refresh AuthContext user so header/OPR name updates immediately
      await refreshUser();
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Failed to update profile' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: 'New passwords do not match' });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      const result = await apiFetch<any>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPwMsg({ type: 'success', text: result.message || 'Password changed. You will be logged out.' });
      setTimeout(() => logout(), 2500);
    } catch (err: any) {
      setPwMsg({ type: 'error', text: err.message || 'Failed to change password' });
    } finally {
      setPwSaving(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiFetch(`/auth/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    } catch { /* silent */ }
  };

  const initials = `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase();

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'password' as const, label: 'Password', icon: Lock },
    { id: 'security' as const, label: 'Security', icon: Shield },
    { id: 'sessions' as const, label: 'Sessions', icon: Key },
  ];

  const handleRegenBackupCodes = async () => {
    if (!regenPassword) return;
    setRegenLoading(true);
    setRegenError('');
    try {
      const data = await apiFetch<any>('/auth/2fa/backup-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify({ password: regenPassword }),
      });
      setRegenCodes(data.backupCodes);
      setRegenPassword('');
    } catch (err: any) {
      setRegenError(err.message || 'Failed to regenerate codes');
    }
    setRegenLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-[520px] max-h-[80vh] flex flex-col"
        style={{
          background: '#1a1a1a',
          border: '1px solid #484848',
          borderTopColor: '#585858',
          borderLeftColor: '#585858',
          borderBottomColor: '#282828',
          borderRightColor: '#282828',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div className="panel-title-bar">
          <User className="title-icon" style={{ width: 14, height: 14 }} />
          <span>ACCOUNT SETTINGS</span>
          <button onClick={onClose} className="ml-auto p-0.5 hover:text-red-400 transition-colors">
            <X style={{ width: 12, height: 12 }} />
          </button>
        </div>

        {/* User Header */}
        <div className="flex items-center gap-3 p-4 border-b border-rmpg-700">
          {user.profile_image ? (
            <img
              src={user.profile_image}
              alt={user.first_name}
              className="w-12 h-12 object-cover border-2 border-rmpg-600"
              style={{ borderRadius: 2 }}
            />
          ) : (
            <div
              className="w-12 h-12 flex items-center justify-center text-base font-bold"
              style={{
                background: 'linear-gradient(135deg, #8a0c0c, #bc1010)',
                color: '#fff',
                border: '2px solid #d93030',
                borderRadius: 2,
              }}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="text-sm font-bold text-white">
              {user.first_name} {user.last_name}
            </div>
            <div className="text-[10px] font-mono" style={{ color: '#a0a0a0' }}>
              {user.badge_number && <span className="mr-2">{user.badge_number}</span>}
              <span className="uppercase">{user.role}</span>
            </div>
            <div className="text-[10px]" style={{ color: '#707070' }}>
              {user.email}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-rmpg-700 bg-surface-raised">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === tab.id ? '#ffffff' : '#707070',
                  borderBottom: activeTab === tab.id ? '2px solid #bc1010' : '2px solid transparent',
                  background: activeTab === tab.id ? 'rgba(188, 16, 16, 0.08)' : 'transparent',
                }}
              >
                <Icon style={{ width: 11, height: 11 }} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'profile' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">First Name</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="input-dark"
                  />
                </div>
                <div>
                  <label className="field-label">Last Name</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="input-dark"
                  />
                </div>
              </div>
              <div>
                <label className="field-label">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-dark"
                />
              </div>
              <div>
                <label className="field-label">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="input-dark"
                  placeholder="(555) 555-5555"
                />
              </div>

              {/* Read-only fields */}
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="field-label">Username</label>
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#111', border: '1px solid #282828' }}>
                    {user.username}
                  </div>
                </div>
                <div>
                  <label className="field-label">Badge #</label>
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#111', border: '1px solid #282828' }}>
                    {user.badge_number || '—'}
                  </div>
                </div>
              </div>

              {profileMsg && (
                <div className={`flex items-center gap-2 px-3 py-2 text-xs ${profileMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                  {profileMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                  {profileMsg.text}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button onClick={handleProfileSave} disabled={profileSaving} className="btn-primary">
                  <Save style={{ width: 12, height: 12 }} />
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'password' && (
            <>
              <div>
                <label className="field-label">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="input-dark pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: '#707070' }}
                  >
                    {showCurrentPw ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="field-label">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input-dark pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: '#707070' }}
                  >
                    {showNewPw ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="field-label">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input-dark"
                />
              </div>

              {pwPolicy.length > 0 && (
                <div className="text-[10px] space-y-0.5 p-2" style={{ color: '#707070', background: '#111', border: '1px solid #282828' }}>
                  <div className="font-bold text-[9px] uppercase tracking-wider mb-1" style={{ color: '#a0a0a0' }}>
                    Password Requirements
                  </div>
                  {pwPolicy.map((rule, i) => (
                    <div key={i}>• {rule}</div>
                  ))}
                </div>
              )}

              {pwMsg && (
                <div className={`flex items-center gap-2 px-3 py-2 text-xs ${pwMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                  {pwMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                  {pwMsg.text}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={handlePasswordChange}
                  disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}
                  className="btn-primary"
                >
                  <Lock style={{ width: 12, height: 12 }} />
                  {pwSaving ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'sessions' && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#a0a0a0' }}>
                Active Sessions
              </div>
              {sessions.length === 0 ? (
                <div className="text-xs text-center py-4" style={{ color: '#707070' }}>No active sessions</div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session: any) => (
                    <div
                      key={session.session_id}
                      className="flex items-center justify-between p-2"
                      style={{ background: '#141414', border: '1px solid #282828' }}
                    >
                      <div>
                        <div className="text-[11px] text-white font-mono">
                          {session.ip_address}
                        </div>
                        <div className="text-[9px]" style={{ color: '#707070' }}>
                          {session.user_agent?.substring(0, 60)}...
                        </div>
                        <div className="text-[9px]" style={{ color: '#505050' }}>
                          Last used: {new Date(session.last_used_at || session.created_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevokeSession(session.session_id)}
                        className="btn-danger btn-xs"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'security' && (
            <>
              {/* Sub-navigation */}
              {securityView === 'overview' && (
                <div className="space-y-4">
                  <SecurityStatusCard />

                  {/* 2FA actions */}
                  <div className="panel-beveled p-3" style={{ background: '#1a1a1a' }}>
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">
                      Two-Factor Authentication
                    </h3>
                    {tfaStatus?.enabled ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="led-dot led-green" />
                          <span style={{ color: '#22c55e' }}>2FA is enabled</span>
                          <span className="text-[9px] ml-auto font-mono" style={{ color: '#6b7280' }}>
                            {tfaStatus.backupCodesRemaining} backup codes left
                          </span>
                        </div>
                        <button
                          onClick={() => setSecurityView('regen-backup')}
                          className="toolbar-btn w-full h-7 text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Regenerate Backup Codes
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="led-dot led-red" />
                          <span style={{ color: '#ef4444' }}>2FA is not enabled</span>
                        </div>
                        <button
                          onClick={() => setSecurityView('setup-2fa')}
                          className="toolbar-btn toolbar-btn-primary w-full h-7 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <Shield className="w-3 h-3" />
                          Set Up 2FA Now
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quick links */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSecurityView('devices')}
                      className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                    >
                      Trusted Devices
                    </button>
                    <button
                      onClick={() => setSecurityView('history')}
                      className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                    >
                      Login History
                    </button>
                  </div>
                </div>
              )}

              {securityView === 'setup-2fa' && (
                <div>
                  <button
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#4a90c4' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <TwoFactorSetupWizard
                    onComplete={() => {
                      setSecurityView('overview');
                      apiFetch<any>('/auth/2fa/status')
                        .then(data => setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }))
                        .catch(() => {});
                    }}
                    onCancel={() => setSecurityView('overview')}
                  />
                </div>
              )}

              {securityView === 'regen-backup' && (
                <div>
                  <button
                    onClick={() => { setSecurityView('overview'); setRegenCodes(null); }}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#4a90c4' }}
                  >
                    ← Back to Security Overview
                  </button>

                  {regenCodes ? (
                    <BackupCodesDisplay
                      codes={regenCodes}
                      onAcknowledge={() => {
                        setRegenCodes(null);
                        setSecurityView('overview');
                        apiFetch<any>('/auth/2fa/status')
                          .then(data => setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }))
                          .catch(() => {});
                      }}
                    />
                  ) : (
                    <div className="space-y-3">
                      <div
                        className="flex items-start gap-2 p-3 text-[10px]"
                        style={{ background: 'rgba(212, 160, 23, 0.12)', border: '1px solid rgba(212, 160, 23, 0.4)', color: '#e8b820' }}
                      >
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>This will invalidate all existing backup codes. Enter your password to confirm.</span>
                      </div>

                      <div>
                        <label className="field-label">Current Password</label>
                        <input
                          type="password"
                          value={regenPassword}
                          onChange={e => setRegenPassword(e.target.value)}
                          className="input-dark"
                          placeholder="Enter your password"
                        />
                      </div>

                      {regenError && (
                        <div className="flex items-center gap-2 text-[10px]" style={{ color: '#ef4444' }}>
                          <AlertCircle className="w-3 h-3" />
                          {regenError}
                        </div>
                      )}

                      <button
                        onClick={handleRegenBackupCodes}
                        disabled={!regenPassword || regenLoading}
                        className="toolbar-btn toolbar-btn-primary w-full h-8 text-white text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {regenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Regenerate Codes'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {securityView === 'devices' && (
                <div>
                  <button
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#4a90c4' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <TrustedDevicesList />
                </div>
              )}

              {securityView === 'history' && (
                <div>
                  <button
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#4a90c4' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <LoginHistoryTable />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
