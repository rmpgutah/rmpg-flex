import React, { useState, useEffect } from 'react';
import { toDisplayLabel } from '../utils/formatters';
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
  ShieldCheck,
  ShieldOff,
  Copy,
  RefreshCw,
  KeyRound,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import TotpCodeInput from './TotpCodeInput';
import SignaturePad from './SignaturePad';

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

  // Digital Signature
  const [signature, setSignature] = useState<string | null>(null);
  const [sigLoaded, setSigLoaded] = useState(false);

  // 2FA / Security
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; required: boolean } | null>(null);
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'backups' | 'disabling'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [setupCode, setSetupCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedBackups, setCopiedBackups] = useState(false);

  // WebAuthn / Security Keys
  const [webauthnStatus, setWebauthnStatus] = useState<{
    enabled: boolean;
    credentialCount: number;
    credentials: { id: number; device_name: string; created_at: string; device_type: string }[];
  } | null>(null);
  const [webauthnBusy, setWebauthnBusy] = useState(false);
  const [webauthnMsg, setWebauthnMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [showKeyNameInput, setShowKeyNameInput] = useState(false);

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
      setSigLoaded(false);
    }
  }, [isOpen, user, initialTab]);

  // Fetch digital signature on profile tab open
  useEffect(() => {
    if (isOpen && activeTab === 'profile' && !sigLoaded) {
      apiFetch<{ signature: string | null }>('/auth/signature')
        .then(data => { setSignature(data?.signature || null); setSigLoaded(true); })
        .catch(() => setSigLoaded(true));
    }
  }, [isOpen, activeTab, sigLoaded]);

  const handleSignatureChange = async (dataUrl: string | null) => {
    setSignature(dataUrl);
    try {
      await apiFetch('/auth/signature', {
        method: 'PUT',
        body: JSON.stringify({ signature: dataUrl }),
      });
    } catch {
      // Revert on failure
      setSignature(signature);
    }
  };

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
      setSecurityMsg(null);
      setSetupStep('idle');
      setSetupCode('');
      setDisablePassword('');
      setCopiedBackups(false);
      setWebauthnMsg(null);
      setShowKeyNameInput(false);
      setNewKeyName('');
      apiFetch<any>('/auth/totp/status')
        .then(data => setTotpStatus(data))
        .catch(() => setTotpStatus(null));
      apiFetch<any>('/auth/webauthn/status')
        .then(data => setWebauthnStatus(data))
        .catch(() => setWebauthnStatus(null));
    }
  }, [isOpen, activeTab]);

  if (!isOpen || !user) return null;

  const handleProfileSave = async () => {
    // Validate mandatory fields
    if (!firstName.trim() || !lastName.trim()) {
      setProfileMsg({ type: 'error', text: 'First and last name are required.' });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), email, phone }),
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

  // ── 2FA Handlers ─────────────────────────────────
  const handleStartSetup = async () => {
    setSecurityBusy(true);
    setSecurityMsg(null);
    try {
      const data = await apiFetch<any>('/auth/totp/setup', { method: 'POST' });
      setQrDataUrl(data.qrCodeDataUrl);
      setBackupCodes(data.backupCodes || []);
      setSetupStep('qr');
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to start 2FA setup' });
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleVerifySetup = async (code: string) => {
    setSecurityBusy(true);
    setSecurityMsg(null);
    try {
      await apiFetch<any>('/auth/totp/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setSetupStep('backups');
      setTotpStatus(prev => prev ? { ...prev, enabled: true } : { enabled: true, required: false });
      setSecurityMsg({ type: 'success', text: 'Two-factor authentication enabled successfully.' });
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Invalid verification code' });
      setSetupCode('');
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disablePassword) return;
    setSecurityBusy(true);
    setSecurityMsg(null);
    try {
      await apiFetch<any>('/auth/totp/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword }),
      });
      setTotpStatus(prev => prev ? { ...prev, enabled: false } : { enabled: false, required: false });
      setSetupStep('idle');
      setDisablePassword('');
      setSecurityMsg({ type: 'success', text: 'Two-factor authentication has been disabled.' });
    } catch (err: any) {
      setSecurityMsg({ type: 'error', text: err.message || 'Failed to disable 2FA' });
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleCopyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBackups(true);
      setTimeout(() => setCopiedBackups(false), 2000);
    }).catch(() => {});
  };

  // ── WebAuthn Handlers ──────────────────────────────
  const handleRegisterKey = async () => {
    const deviceName = newKeyName.trim() || 'Security Key';
    setWebauthnBusy(true);
    setWebauthnMsg(null);
    try {
      // Step 1: Get registration options from server
      const options = await apiFetch<any>('/auth/webauthn/register/begin', {
        method: 'POST',
        body: JSON.stringify({ deviceName }),
      });

      // Step 2: Use browser WebAuthn API
      const { startRegistration } = await import('@simplewebauthn/browser');
      const credential = await startRegistration({ optionsJSON: options });

      // Step 3: Send response to server
      await apiFetch<any>('/auth/webauthn/register/complete', {
        method: 'POST',
        body: JSON.stringify({
          response: credential,
          challenge: options.challenge,
          deviceName,
        }),
      });

      setWebauthnMsg({ type: 'success', text: `Security key "${deviceName}" registered successfully.` });
      setShowKeyNameInput(false);
      setNewKeyName('');

      // Refresh status
      const status = await apiFetch<any>('/auth/webauthn/status');
      setWebauthnStatus(status);
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setWebauthnMsg({ type: 'error', text: 'Registration was cancelled or timed out.' });
      } else {
        setWebauthnMsg({ type: 'error', text: err.message || 'Failed to register security key' });
      }
    } finally {
      setWebauthnBusy(false);
    }
  };

  const handleRemoveKey = async (credId: number, name: string) => {
    setWebauthnBusy(true);
    setWebauthnMsg(null);
    try {
      await apiFetch(`/auth/webauthn/credentials/${credId}`, { method: 'DELETE' });
      setWebauthnMsg({ type: 'success', text: `Security key "${name}" removed.` });
      const status = await apiFetch<any>('/auth/webauthn/status');
      setWebauthnStatus(status);
    } catch (err: any) {
      setWebauthnMsg({ type: 'error', text: err.message || 'Failed to remove key' });
    } finally {
      setWebauthnBusy(false);
    }
  };

  const initials = `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase();

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'password' as const, label: 'Password', icon: Lock },
    { id: 'security' as const, label: '2FA', icon: ShieldCheck },
    { id: 'sessions' as const, label: 'Sessions', icon: Shield },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-[480px] max-h-[80vh] flex flex-col"
        style={{
          background: '#141e2b',
          border: '1px solid #484848',
          borderTopColor: '#585858',
          borderLeftColor: '#585858',
          borderBottomColor: '#162236',
          borderRightColor: '#162236',
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
                background: 'linear-gradient(135deg, #144a7e, #1a5a9e)',
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
              <span className="uppercase">{toDisplayLabel(user.role)}</span>
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
                  borderBottom: activeTab === tab.id ? '2px solid #1a5a9e' : '2px solid transparent',
                  background: activeTab === tab.id ? 'rgba(26, 90, 158, 0.08)' : 'transparent',
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
                  <label className="field-label">First Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="input-dark"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Last Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="input-dark"
                    required
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
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#111', border: '1px solid #162236' }}>
                    {user.username}
                  </div>
                </div>
                <div>
                  <label className="field-label">Badge #</label>
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#111', border: '1px solid #162236' }}>
                    {user.badge_number || '—'}
                  </div>
                </div>
              </div>

              {/* Digital Signature */}
              <div className="mt-3 pt-3 border-t border-rmpg-700">
                <SignaturePad
                  value={signature}
                  onChange={handleSignatureChange}
                  label="Digital Signature (for PDF reports)"
                  compact
                />
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
                <div className="text-[10px] space-y-0.5 p-2" style={{ color: '#707070', background: '#111', border: '1px solid #162236' }}>
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

          {activeTab === 'security' && (
            <>
              {/* Status indicator */}
              <div
                className="flex items-center gap-3 p-3 mb-3"
                style={{
                  background: totpStatus?.enabled ? 'rgba(34, 197, 94, 0.08)' : 'rgba(26, 90, 158, 0.08)',
                  border: `1px solid ${totpStatus?.enabled ? '#166534' : '#144a7e'}`,
                }}
              >
                {totpStatus?.enabled ? (
                  <ShieldCheck style={{ width: 20, height: 20, color: '#4ade80' }} />
                ) : (
                  <ShieldOff style={{ width: 20, height: 20, color: '#ef7a7a' }} />
                )}
                <div>
                  <div className="text-xs font-bold" style={{ color: totpStatus?.enabled ? '#4ade80' : '#ef7a7a' }}>
                    {totpStatus?.enabled ? 'Two-Factor Authentication Enabled' : 'Two-Factor Authentication Disabled'}
                  </div>
                  <div className="text-[9px]" style={{ color: '#707070' }}>
                    {totpStatus?.enabled
                      ? 'Your account is protected with authenticator app verification.'
                      : totpStatus?.required
                        ? 'Your role requires 2FA. Please enable it immediately.'
                        : 'Add an extra layer of security to your account.'}
                  </div>
                </div>
              </div>

              {securityMsg && (
                <div className={`flex items-center gap-2 px-3 py-2 text-xs mb-3 ${securityMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                  {securityMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                  {securityMsg.text}
                </div>
              )}

              {/* ── Idle: Enable / Disable buttons ──────── */}
              {setupStep === 'idle' && !totpStatus?.enabled && (
                <button
                  onClick={handleStartSetup}
                  disabled={securityBusy}
                  className="btn-primary w-full"
                >
                  <ShieldCheck style={{ width: 12, height: 12 }} />
                  {securityBusy ? 'Setting up...' : 'Enable Two-Factor Authentication'}
                </button>
              )}

              {setupStep === 'idle' && totpStatus?.enabled && (
                <button
                  onClick={() => { setSetupStep('disabling'); setSecurityMsg(null); }}
                  className="btn-danger w-full"
                >
                  <ShieldOff style={{ width: 12, height: 12 }} />
                  Disable Two-Factor Authentication
                </button>
              )}

              {/* ── Step 1: Show QR Code ────────────────── */}
              {setupStep === 'qr' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                    Step 1: Scan QR Code
                  </div>
                  <p className="text-[10px]" style={{ color: '#707070' }}>
                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                  </p>
                  <div className="flex justify-center py-2">
                    {qrDataUrl && (
                      <img
                        src={qrDataUrl}
                        alt="TOTP QR Code"
                        style={{ width: 200, height: 200, imageRendering: 'pixelated' }}
                        draggable={false}
                      />
                    )}
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-3" style={{ color: '#a0a0a0' }}>
                    Step 2: Enter Verification Code
                  </div>
                  <p className="text-[10px]" style={{ color: '#707070' }}>
                    Enter the 6-digit code from your authenticator app to verify setup.
                  </p>
                  <TotpCodeInput
                    value={setupCode}
                    onChange={setSetupCode}
                    onComplete={handleVerifySetup}
                    disabled={securityBusy}
                    error={securityMsg?.type === 'error'}
                  />
                  {securityBusy && (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span className="text-[10px]" style={{ color: '#a0a0a0' }}>Verifying...</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setSetupStep('idle'); setSecurityMsg(null); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#e0e0e0'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#666'; }}
                  >
                    Cancel Setup
                  </button>
                </div>
              )}

              {/* ── Step 3: Show Backup Codes ──────────── */}
              {setupStep === 'backups' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                    Recovery Codes
                  </div>
                  <div
                    className="p-3"
                    style={{
                      background: '#060c14',
                      border: '1px solid #144a7e',
                    }}
                  >
                    <div className="flex items-center gap-1 mb-2">
                      <AlertCircle style={{ width: 12, height: 12, color: '#d93030' }} />
                      <span className="text-[9px] font-bold uppercase" style={{ color: '#d93030' }}>
                        Save these codes — they will not be shown again
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {backupCodes.map((code, i) => (
                        <div
                          key={i}
                          className="text-center font-mono text-xs py-1"
                          style={{ background: '#0d1520', border: '1px solid #162236', color: '#e0e0e0' }}
                        >
                          {code}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCopyBackupCodes} className="btn-secondary flex-1">
                      {copiedBackups ? (
                        <><Check style={{ width: 12, height: 12 }} /> Copied!</>
                      ) : (
                        <><Copy style={{ width: 12, height: 12 }} /> Copy Codes</>
                      )}
                    </button>
                    <button
                      onClick={() => { setSetupStep('idle'); setSecurityMsg(null); }}
                      className="btn-primary flex-1"
                    >
                      <Check style={{ width: 12, height: 12 }} /> Done
                    </button>
                  </div>
                </div>
              )}

              {/* ── Disable 2FA: Re-enter password ─────── */}
              {setupStep === 'disabling' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                    Confirm Disable
                  </div>
                  <p className="text-[10px]" style={{ color: '#707070' }}>
                    Enter your password to confirm disabling two-factor authentication.
                  </p>
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={e => setDisablePassword(e.target.value)}
                    className="input-dark"
                    placeholder="Current password"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setSetupStep('idle'); setSecurityMsg(null); setDisablePassword(''); }}
                      className="btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDisable2FA}
                      disabled={securityBusy || !disablePassword}
                      className="btn-danger flex-1"
                    >
                      <ShieldOff style={{ width: 12, height: 12 }} />
                      {securityBusy ? 'Disabling...' : 'Disable 2FA'}
                    </button>
                  </div>
                </div>
              )}

              {/* ═══════════════════════════════════════════ */}
              {/* ── Security Keys (WebAuthn / YubiKey) ───── */}
              {/* ═══════════════════════════════════════════ */}
              <div className="mt-4 pt-4 border-t border-rmpg-700">
                <div className="flex items-center gap-2 mb-3">
                  <KeyRound style={{ width: 16, height: 16, color: '#1a5a9e' }} />
                  <div className="text-xs font-bold uppercase tracking-wider" style={{ color: '#a0a0a0' }}>
                    Security Keys
                  </div>
                  <div className="text-[9px] ml-auto" style={{ color: '#555' }}>
                    YubiKey / FIDO2
                  </div>
                </div>

                {webauthnMsg && (
                  <div className={`flex items-center gap-2 px-3 py-2 text-xs mb-3 ${webauthnMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                    {webauthnMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                    {webauthnMsg.text}
                  </div>
                )}

                {/* Registered keys list */}
                {webauthnStatus && webauthnStatus.credentials.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {webauthnStatus.credentials.map(cred => (
                      <div
                        key={cred.id}
                        className="flex items-center justify-between p-2"
                        style={{ background: '#0d1520', border: '1px solid #162236' }}
                      >
                        <div className="flex items-center gap-2">
                          <KeyRound style={{ width: 13, height: 13, color: '#4ade80' }} />
                          <div>
                            <div className="text-[11px] text-white font-bold">{cred.device_name}</div>
                            <div className="text-[9px]" style={{ color: '#555' }}>
                              Added {new Date(cred.created_at).toLocaleDateString()} · {cred.device_type}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveKey(cred.id, cred.device_name)}
                          disabled={webauthnBusy}
                          className="p-1 transition-colors hover:text-red-400"
                          style={{ color: '#555' }}
                          title="Remove key"
                        >
                          <Trash2 style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {webauthnStatus && webauthnStatus.credentials.length === 0 && (
                  <p className="text-[10px] mb-3" style={{ color: '#555' }}>
                    No security keys registered. Add a YubiKey or FIDO2 security key for hardware-based 2FA.
                  </p>
                )}

                {/* Register new key */}
                {showKeyNameInput ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={e => setNewKeyName(e.target.value)}
                      className="input-dark"
                      placeholder="Key name (e.g., 'Office YubiKey')"
                      autoFocus
                      maxLength={50}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowKeyNameInput(false); setNewKeyName(''); setWebauthnMsg(null); }}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleRegisterKey}
                        disabled={webauthnBusy}
                        className="btn-primary flex-1"
                      >
                        <KeyRound style={{ width: 12, height: 12 }} />
                        {webauthnBusy ? 'Waiting for key...' : 'Register Key'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setShowKeyNameInput(true); setWebauthnMsg(null); }}
                    className="btn-secondary w-full"
                  >
                    <Plus style={{ width: 12, height: 12 }} />
                    Add Security Key
                  </button>
                )}
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
                      style={{ background: '#0d1520', border: '1px solid #162236' }}
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
        </div>
      </div>
    </div>
  );
}
