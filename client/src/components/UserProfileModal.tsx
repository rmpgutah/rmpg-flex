import React, { useState, useEffect, useRef } from 'react';
import { toDisplayLabel, formatPhoneInput } from '../utils/formatters';
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
  RefreshCw,
  Camera,
  Trash2,
  Upload,
  Settings,
  Bell,
  Monitor,
  RotateCcw,
  Key,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import TotpCodeInput from './TotpCodeInput';
import SignaturePad from './SignaturePad';
import TrustedDevicesList from './security/TrustedDevicesList';
import LoginHistoryTable from './security/LoginHistoryTable';
import SecurityKeyManager from './security/SecurityKeyManager';
import BackupCodesDisplay from './security/BackupCodesDisplay';
import SecurityStatusCard from './security/SecurityStatusCard';
import TwoFactorSetupWizard from './security/TwoFactorSetupWizard';
import { applyThemePreference, normalizeThemePreference } from '../utils/theme';

interface UserPreferences {
  notify_dispatch_email: number;
  notify_dispatch_inapp: number;
  notify_bolo_email: number;
  notify_bolo_inapp: number;
  notify_warrant_email: number;
  notify_warrant_inapp: number;
  notify_system_email: number;
  notify_system_inapp: number;
  notify_credential_email: number;
  notify_credential_inapp: number;
  notify_pso_email: number;
  notify_pso_inapp: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  font_scale: number;
  compact_mode: number;
  show_map_labels: number;
  default_map_style: string;
  dispatch_sort: string;
  dispatch_show_cleared: number;
  theme_preference: 'dark' | 'light';
  [key: string]: any;
}

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'profile' | 'password' | 'sessions' | 'security' | 'preferences';
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

  // Profile Image
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileImageLoaded, setProfileImageLoaded] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);
  const justUploadedImage = useRef(false); // Guards against useEffect resetting profileImage after upload
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User Preferences
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 2FA / Security
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; required: boolean } | null>(null);
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'backups' | 'disabling'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [setupCode, setSetupCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [securityView, setSecurityView] = useState<'main' | 'overview' | 'devices' | 'history' | 'keys' | 'setup-2fa' | 'regen-backup'>('main');

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

  // Security tab state (remote)
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState('');

  // Body scroll lock — prevent background scrolling when modal is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }
    return () => {
      const scrollY = Math.abs(parseInt(document.body.style.top || '0'));
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY > 0) window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

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
      setPrefsLoaded(false);
      setPrefsMsg(null);
      // Don't reset profile image if we just uploaded — the local state is already correct
      if (justUploadedImage.current) {
        justUploadedImage.current = false;
      } else {
        setProfileImageLoaded(false);
        setProfileImage(user.profile_image || null);
      }
    }
  }, [isOpen, user, initialTab]);

  // Cleanup logout timer on unmount
  useEffect(() => {
    return () => { if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current); };
  }, []);

  // Fetch digital signature + profile image on profile tab open
  useEffect(() => {
    if (isOpen && activeTab === 'profile' && !sigLoaded) {
      apiFetch<{ signature: string | null }>('/auth/signature')
        .then(data => { setSignature(data?.signature || null); setSigLoaded(true); })
        .catch(() => setSigLoaded(true));
    }
    if (isOpen && activeTab === 'profile' && !profileImageLoaded) {
      apiFetch<{ profile_image: string | null }>('/auth/profile-image')
        .then(data => { setProfileImage(data?.profile_image || null); setProfileImageLoaded(true); })
        .catch(() => setProfileImageLoaded(true));
    }
  }, [isOpen, activeTab, sigLoaded, profileImageLoaded]);

  // Profile image upload handler — resizes to 256px, converts to JPEG base64, saves to server
  const handleProfileImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      setProfileMsg({ type: 'error', text: 'Image must be under 10MB' });
      return;
    }
    setImageUploading(true);
    try {
      // Step 1: Read file as data URL via FileReader (more reliable than blob URL)
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Step 2: Resize to 256×256 and compress as JPEG to keep DB payload small
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const size = 256;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
            // Center-crop: take the largest square from the center
            const srcSize = Math.min(img.width, img.height);
            const sx = (img.width - srcSize) / 2;
            const sy = (img.height - srcSize) / 2;
            ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
            const result = canvas.toDataURL('image/jpeg', 0.85);
            if (!result || result === 'data:,') {
              reject(new Error('Canvas produced empty image'));
              return;
            }
            resolve(result);
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image for resizing'));
        img.src = rawDataUrl; // Use the FileReader data URL, not a blob URL
      });

      // Step 3: Validate the data URL is complete before sending
      const b64Match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/);
      if (!b64Match) {
        throw new Error('Generated image data URL is malformed');
      }
      const b64Data = b64Match[1];
      // Pad base64 if needed (some browsers omit padding)
      const paddedB64 = b64Data.length % 4 === 0 ? b64Data
        : b64Data + '='.repeat(4 - (b64Data.length % 4));
      const validatedDataUrl = dataUrl.replace(b64Data, paddedB64);

      // Step 4: Verify the data URL renders before uploading
      await new Promise<void>((resolve, reject) => {
        const testImg = new Image();
        testImg.onload = () => resolve();
        testImg.onerror = () => reject(new Error('Generated image failed to render'));
        testImg.src = validatedDataUrl;
      });

      // Step 5: Upload to server
      const jsonBody = JSON.stringify({ profile_image: validatedDataUrl });
      await apiFetch('/auth/profile-image', {
        method: 'PUT',
        body: jsonBody,
      });

      // Step 6: Verify the server stored it correctly
      const stored = await apiFetch<{ profile_image: string | null }>('/auth/profile-image');
      if (!stored?.profile_image || stored.profile_image.length !== validatedDataUrl.length) {
        console.error('Server storage mismatch:', {
          sent: validatedDataUrl.length,
          received: stored?.profile_image?.length ?? 0,
        });
        throw new Error('Image was not stored correctly on the server');
      }

      // Step 7: Update local state immediately, then refresh context
      setProfileImage(validatedDataUrl);
      setProfileImageLoaded(true);
      justUploadedImage.current = true; // Prevent useEffect from resetting our state
      await refreshUser();
      setProfileMsg({ type: 'success', text: 'Profile photo updated.' });
    } catch (err) {
      console.error('Profile image upload error:', err);
      setProfileMsg({ type: 'error', text: 'Failed to upload profile photo.' });
    } finally {
      setImageUploading(false);
    }
  };

  const handleRemoveProfileImage = async () => {
    setImageUploading(true);
    try {
      await apiFetch('/auth/profile-image', {
        method: 'PUT',
        body: JSON.stringify({ profile_image: null }),
      });
      setProfileImage(null);
      setProfileImageLoaded(true);
      justUploadedImage.current = true;
      await refreshUser();
      setProfileMsg({ type: 'success', text: 'Profile photo removed.' });
    } catch {
      setProfileMsg({ type: 'error', text: 'Failed to remove profile photo.' });
    } finally {
      setImageUploading(false);
    }
  };

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
        .catch((err) => { console.warn('[UserProfileModal] fetch password policy failed:', err); });
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
      setSecurityView('main');
      apiFetch<any>('/auth/totp/status')
        .then(data => setTotpStatus(data))
        .catch(() => setTotpStatus(null));
      apiFetch<any>('/auth/webauthn/status')
        .then(data => setWebauthnStatus(data))
        .catch(() => setWebauthnStatus(null));
      apiFetch<any>('/auth/2fa/status')
        .then(data => setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }))
        .catch((err) => { console.warn('[UserProfileModal] fetch 2FA status failed:', err); });
      setSecurityView('overview');
      setRegenCodes(null);
      setRegenPassword('');
      setRegenError('');
    }
    if (isOpen && activeTab === 'preferences' && !prefsLoaded) {
      apiFetch<UserPreferences>('/user/preferences')
        .then(data => { setPrefs(data); setPrefsLoaded(true); })
        .catch(() => setPrefsLoaded(true));
    }
  }, [isOpen, activeTab, prefsLoaded]);

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
      setProfileMsg({ type: 'error', text: err?.message || 'Failed to update profile' });
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
      logoutTimerRef.current = setTimeout(() => logout(), 2500);
    } catch (err: any) {
      setPwMsg({ type: 'error', text: err?.message || 'Failed to change password' });
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
      setSecurityMsg({ type: 'error', text: err?.message || 'Failed to start 2FA setup' });
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
      setSecurityMsg({ type: 'error', text: err?.message || 'Invalid verification code' });
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
      setSecurityMsg({ type: 'error', text: err?.message || 'Failed to disable 2FA' });
    } finally {
      setSecurityBusy(false);
    }
  };

  const initials = `${(user.first_name || 'U')[0]}${(user.last_name || '')[0] || ''}`.toUpperCase();

  const tabs = [
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'preferences' as const, label: 'Prefs', icon: Settings },
    { id: 'password' as const, label: 'Password', icon: Lock },
    { id: 'security' as const, label: 'Security', icon: ShieldCheck },
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
      setRegenError(err?.message || 'Failed to regenerate codes');
    }
    setRegenLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose} role="presentation" style={{ touchAction: 'manipulation' }}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-[520px] max-w-[95vw] max-h-[80vh] flex flex-col"
        style={{
          background: '#0a0a0a',
          border: '1px solid #3a5070',
          borderTopColor: '#383838',
          borderLeftColor: '#383838',
          borderBottomColor: '#181818',
          borderRightColor: '#181818',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Title Bar */}
        <div className="panel-title-bar">
          <User className="title-icon" style={{ width: 14, height: 14 }} />
          <span>ACCOUNT SETTINGS</span>
          <button type="button" onClick={onClose} className="ml-auto p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-red-400 transition-colors" style={{ touchAction: 'manipulation' }} aria-label="Close">
            <X className="w-5 h-5 sm:w-3 sm:h-3" />
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
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div
              className="w-12 h-12 flex items-center justify-center text-base font-bold"
              style={{
                background: 'linear-gradient(135deg, #333333, #888888)',
                color: '#fff',
                border: '2px solid #aaaaaa',
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
            <div className="text-[10px] font-mono" style={{ color: '#888888' }}>
              {user.badge_number && <span className="mr-2">{user.badge_number}</span>}
              <span className="uppercase">{toDisplayLabel(user.role)}</span>
            </div>
            <div className="text-[10px]" style={{ color: '#666666' }}>
              {user.email}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-rmpg-700 bg-surface-raised">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === tab.id ? '#ffffff' : '#666666',
                  borderBottom: activeTab === tab.id ? '2px solid #888888' : '2px solid transparent',
                  background: activeTab === tab.id ? 'rgba(136, 136, 136, 0.08)' : 'transparent',
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  onChange={e => setPhone(formatPhoneInput(e.target.value))}
                  className="input-dark"
                  placeholder="(555) 555-5555"
                />
              </div>

              {/* Read-only fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="field-label">Username</label>
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#030303', border: '1px solid #242a32' }}>
                    {user.username}
                  </div>
                </div>
                <div>
                  <label className="field-label">Badge #</label>
                  <div className="text-xs text-white px-3 py-1.5" style={{ background: '#030303', border: '1px solid #242a32' }}>
                    {user.badge_number || '—'}
                  </div>
                </div>
              </div>

              {/* Profile Photo Upload */}
              <div className="mt-3 pt-3 border-t border-rmpg-700">
                <label className="field-label flex items-center gap-1.5 mb-2">
                  <Camera style={{ width: 11, height: 11 }} />
                  Profile Photo
                </label>
                <div className="flex items-start gap-4">
                  {/* Preview */}
                  <div className="flex-shrink-0">
                    {profileImage ? (
                      <img
                        src={profileImage}
                        alt="Profile"
                        className="w-20 h-20 object-cover border-2 border-rmpg-600"
                        style={{ borderRadius: 2 }}
                        onError={() => { setProfileImage(null); }}
                      />
                    ) : (
                      <div
                        className="w-20 h-20 flex items-center justify-center text-xl font-bold"
                        style={{
                          background: 'linear-gradient(135deg, #333333, #888888)',
                          color: '#fff',
                          border: '2px solid #2a4a6e',
                          borderRadius: 2,
                        }}
                      >
                        {initials}
                      </div>
                    )}
                  </div>

                  {/* Drop zone + buttons */}
                  <div className="flex-1 space-y-2">
                    <div
                      className="relative border-2 border-dashed px-4 py-3 text-center transition-colors cursor-pointer"
                      style={{
                        borderColor: imageDragOver ? '#888888' : '#222222',
                        background: imageDragOver ? 'rgba(136, 136, 136, 0.12)' : '#030303',
                        borderRadius: 2,
                      }}
                      onDragOver={e => { e.preventDefault(); setImageDragOver(true); }}
                      onDragLeave={() => setImageDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setImageDragOver(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleProfileImageFile(file);
                      }}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.onchange = () => {
                          const file = input.files?.[0];
                          if (file) handleProfileImageFile(file);
                        };
                        input.click();
                      }}
                    >
                      <Upload style={{ width: 16, height: 16, margin: '0 auto 4px', color: '#666666' }} />
                      <div className="text-[10px]" style={{ color: '#666666' }}>
                        {imageUploading ? 'Uploading...' : 'Drop image here or click to browse'}
                      </div>
                      <div className="text-[9px] mt-0.5" style={{ color: '#3a3a3a' }}>
                        JPG, PNG, WebP — max 2MB
                      </div>
                    </div>
                    {profileImage && (
                      <button type="button"
                        onClick={handleRemoveProfileImage}
                        disabled={imageUploading}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 hover:text-red-400 transition-colors"
                        style={{ color: '#666666' }}
                      >
                        <Trash2 style={{ width: 10, height: 10 }} />
                        Remove photo
                      </button>
                    )}
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
                <button type="button" onClick={handleProfileSave} disabled={profileSaving} className="btn-primary">
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
                    style={{ color: '#666666' }}
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
                    style={{ color: '#666666' }}
                  >
                    {showNewPw ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="field-label">Confirm New Password</label>
                <input
                  type="password" autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input-dark"
                />
              </div>

              {pwPolicy.length > 0 && (
                <div className="text-[10px] space-y-0.5 p-2" style={{ color: '#666666', background: '#030303', border: '1px solid #242a32' }}>
                  <div className="font-bold text-[9px] uppercase tracking-wider mb-1" style={{ color: '#888888' }}>
                    Password Requirements
                  </div>
                  {pwPolicy.map((rule, i) => (
                    <div key={rule}>• {rule}</div>
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
                <button type="button"
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

          {activeTab === 'preferences' && (
            <>
              {!prefsLoaded ? (
                <div className="text-xs text-center py-4" style={{ color: '#666666' }}>Loading preferences...</div>
              ) : prefs ? (
                <>
                  {/* Notification Preferences */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Bell style={{ width: 11, height: 11, color: '#888888' }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                        Notification Preferences
                      </span>
                    </div>
                    <div className="space-y-1.5" style={{ background: '#050505', border: '1px solid #242a32', padding: '8px 10px' }}>
                      {[
                        { key: 'dispatch', label: 'Dispatch Alerts' },
                        { key: 'bolo', label: 'BOLO Alerts' },
                        { key: 'warrant', label: 'Warrant Alerts' },
                        { key: 'pso', label: 'PSO / 72hr Alerts' },
                        { key: 'credential', label: 'Credential Expiry' },
                        { key: 'system', label: 'System Notices' },
                      ].map(({ key, label }) => (
                        <div key={key} className="flex items-center justify-between">
                          <span className="text-[11px] text-rmpg-200">{label}</span>
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!prefs[`notify_${key}_inapp`]}
                                onChange={e => setPrefs({ ...prefs, [`notify_${key}_inapp`]: e.target.checked ? 1 : 0 })}
                                className="w-3 h-3"
                              />
                              <span className="text-[9px]" style={{ color: '#666666' }}>In-App</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!prefs[`notify_${key}_email`]}
                                onChange={e => setPrefs({ ...prefs, [`notify_${key}_email`]: e.target.checked ? 1 : 0 })}
                                className="w-3 h-3"
                              />
                              <span className="text-[9px]" style={{ color: '#666666' }}>Email</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Feature 23: Notification sound toggle */}
                  <div className="mt-3" style={{ background: '#050505', border: '1px solid #242a32', padding: '8px 10px' }}>
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-[11px] text-rmpg-200">Enable Notification Sounds</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={localStorage.getItem('rmpg_notification_sounds') !== 'false'}
                          onChange={(e) => {
                            localStorage.setItem('rmpg_notification_sounds', String(e.target.checked));
                          }}
                          className="w-4 h-4 accent-green-500"
                        />
                        <span className="text-[9px] font-mono" style={{ color: localStorage.getItem('rmpg_notification_sounds') !== 'false' ? '#22c55e' : '#ef4444' }}>
                          {localStorage.getItem('rmpg_notification_sounds') !== 'false' ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* Quiet Hours */}
                  <div className="mt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                      Quiet Hours (Suppress Notifications)
                    </span>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <label className="field-label">Start</label>
                        <input
                          type="time"
                          value={prefs.quiet_hours_start || ''}
                          onChange={e => setPrefs({ ...prefs, quiet_hours_start: e.target.value || null })}
                          className="input-dark text-xs"
                        />
                      </div>
                      <div>
                        <label className="field-label">End</label>
                        <input
                          type="time"
                          value={prefs.quiet_hours_end || ''}
                          onChange={e => setPrefs({ ...prefs, quiet_hours_end: e.target.value || null })}
                          className="input-dark text-xs"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Display Preferences */}
                  <div className="mt-3 pt-3 border-t border-rmpg-700">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Monitor style={{ width: 11, height: 11, color: '#888888' }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                        Display Settings
                      </span>
                    </div>
                    <div className="space-y-2">
                      {/* Feature 32: Dark/Light Theme Toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Theme</span>
                        <select
                          value={prefs.theme_preference || 'dark'}
                          onChange={e => {
                            const theme = normalizeThemePreference(e.target.value);
                            setPrefs({ ...prefs, theme_preference: theme });
                            applyThemePreference(theme);
                          }}
                          className="input-dark text-[10px] py-0.5 px-1 w-24"
                        >
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                        </select>
                      </div>
                      {/* Feature 33: Font Size Adjustment */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Font Size</span>
                        <select
                          value={prefs.font_size_preference || 'medium'}
                          onChange={e => {
                            const size = e.target.value;
                            setPrefs({ ...prefs, font_size_preference: size });
                            document.documentElement.classList.remove('font-small', 'font-medium', 'font-large');
                            document.documentElement.classList.add(`font-${size}`);
                          }}
                          className="input-dark text-[10px] py-0.5 px-1 w-24"
                        >
                          <option value="small">Small</option>
                          <option value="medium">Medium</option>
                          <option value="large">Large</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Font Scale</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0.8"
                            max="1.4"
                            step="0.1"
                            value={prefs.font_scale}
                            onChange={e => setPrefs({ ...prefs, font_scale: parseFloat(e.target.value) })}
                            className="w-24 h-1"
                          />
                          <span className="text-[10px] font-mono w-8 text-right" style={{ color: '#666666' }}>
                            {(prefs.font_scale * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Compact Mode</span>
                        <input
                          type="checkbox"
                          checked={!!prefs.compact_mode}
                          onChange={e => setPrefs({ ...prefs, compact_mode: e.target.checked ? 1 : 0 })}
                          className="w-3 h-3"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Map Labels</span>
                        <input
                          type="checkbox"
                          checked={!!prefs.show_map_labels}
                          onChange={e => setPrefs({ ...prefs, show_map_labels: e.target.checked ? 1 : 0 })}
                          className="w-3 h-3"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Default Map Style</span>
                        <select
                          value={prefs.default_map_style}
                          onChange={e => setPrefs({ ...prefs, default_map_style: e.target.value })}
                          className="input-dark text-[10px] py-0.5 px-1 w-24"
                        >
                          <option value="dark">Dark</option>
                          <option value="satellite">Satellite</option>
                          <option value="terrain">Terrain</option>
                          <option value="roadmap">Roadmap</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Dispatch Board Preferences */}
                  <div className="mt-3 pt-3 border-t border-rmpg-700">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                      Dispatch Board
                    </span>
                    <div className="space-y-2 mt-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Default Sort</span>
                        <select
                          value={prefs.dispatch_sort}
                          onChange={e => setPrefs({ ...prefs, dispatch_sort: e.target.value })}
                          className="input-dark text-[10px] py-0.5 px-1 w-28"
                        >
                          <option value="priority">By Priority</option>
                          <option value="time">By Time (Newest)</option>
                          <option value="status">By Status</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Show Cleared Calls</span>
                        <input
                          type="checkbox"
                          checked={!!prefs.dispatch_show_cleared}
                          onChange={e => setPrefs({ ...prefs, dispatch_show_cleared: e.target.checked ? 1 : 0 })}
                          className="w-3 h-3"
                        />
                      </div>
                    </div>
                  </div>

                  {prefsMsg && (
                    <div className={`flex items-center gap-2 px-3 py-2 text-xs mt-3 ${prefsMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                      {prefsMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                      {prefsMsg.text}
                    </div>
                  )}

                  <div className="flex justify-between pt-3">
                    <button type="button"
                      onClick={async () => {
                        try {
                          const result = await apiFetch<UserPreferences>('/user/preferences/reset', { method: 'POST' });
                          setPrefs(result);
                          setPrefsMsg({ type: 'success', text: 'Preferences reset to defaults.' });
                        } catch {
                          setPrefsMsg({ type: 'error', text: 'Failed to reset preferences.' });
                        }
                      }}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 transition-colors"
                      style={{ color: '#666666' }}
                    >
                      <RotateCcw style={{ width: 10, height: 10 }} />
                      Reset to Defaults
                    </button>
                    <button type="button"
                      onClick={async () => {
                        setPrefsSaving(true);
                        setPrefsMsg(null);
                        try {
                          const { user_id, updated_at, ...updates } = prefs;
                          const result = await apiFetch<UserPreferences>('/user/preferences', {
                            method: 'PUT',
                            body: JSON.stringify(updates),
                          });
                          setPrefs(result);
                          setPrefsMsg({ type: 'success', text: 'Preferences saved.' });
                        } catch {
                          setPrefsMsg({ type: 'error', text: 'Failed to save preferences.' });
                        } finally {
                          setPrefsSaving(false);
                        }
                      }}
                      disabled={prefsSaving}
                      className="btn-primary"
                    >
                      <Save style={{ width: 12, height: 12 }} />
                      {prefsSaving ? 'Saving...' : 'Save Preferences'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-center py-4" style={{ color: '#666666' }}>Failed to load preferences</div>
              )}
            </>
          )}

          {activeTab === 'security' && (
            <>
              {/* Security sub-view navigation */}
              {securityView !== 'main' && (
                <button type="button"
                  onClick={() => setSecurityView('main')}
                  className="text-[10px] mb-3 flex items-center gap-1"
                  style={{ color: '#888888' }}
                >
                  &larr; Back to Security
                </button>
              )}

              {securityView === 'devices' && <TrustedDevicesList />}
              {securityView === 'history' && <LoginHistoryTable />}
              {securityView === 'keys' && <SecurityKeyManager />}

              {securityView === 'main' && (
              <>
              {/* Security overview card */}
              <div className="mb-3">
                <SecurityStatusCard />
              </div>

              {/* Status indicator */}
              <div
                className="flex items-center gap-3 p-3 mb-3"
                style={{
                  background: totpStatus?.enabled ? 'rgba(34, 197, 94, 0.08)' : 'rgba(220, 38, 38, 0.08)',
                  border: `1px solid ${totpStatus?.enabled ? '#166534' : '#991b1b'}`,
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
                  <div className="text-[9px]" style={{ color: '#666666' }}>
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
                <button type="button"
                  onClick={handleStartSetup}
                  disabled={securityBusy}
                  className="btn-primary w-full"
                >
                  <ShieldCheck style={{ width: 12, height: 12 }} />
                  {securityBusy ? 'Setting up...' : 'Enable Two-Factor Authentication'}
                </button>
              )}

              {setupStep === 'idle' && totpStatus?.enabled && (
                <button type="button"
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
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                    Step 1: Scan QR Code
                  </div>
                  <p className="text-[10px]" style={{ color: '#666666' }}>
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
                  <div className="text-[10px] font-bold uppercase tracking-wider mt-3" style={{ color: '#888888' }}>
                    Step 2: Enter Verification Code
                  </div>
                  <p className="text-[10px]" style={{ color: '#666666' }}>
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
                      <span className="text-[10px]" style={{ color: '#888888' }}>Verifying...</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { setSetupStep('idle'); setSecurityMsg(null); }}
                    className="text-[10px] uppercase tracking-wide font-bold transition-colors"
                    style={{ color: '#666666' }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#aaaaaa'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#666666'; }}
                  >
                    Cancel Setup
                  </button>
                </div>
              )}

              {/* ── Step 3: Show Backup Codes ──────────── */}
              {setupStep === 'backups' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                    Recovery Codes
                  </div>
                  <BackupCodesDisplay
                    codes={backupCodes}
                    onAcknowledge={() => { setSetupStep('idle'); setSecurityMsg(null); }}
                  />
                </div>
              )}

              {/* ── Disable 2FA: Re-enter password ─────── */}
              {setupStep === 'disabling' && (
                <div className="space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#888888' }}>
                    Confirm Disable
                  </div>
                  <p className="text-[10px]" style={{ color: '#666666' }}>
                    Enter your password to confirm disabling two-factor authentication.
                  </p>
                  <input
                    type="password" autoComplete="new-password"
                    value={disablePassword}
                    onChange={e => setDisablePassword(e.target.value)}
                    className="input-dark"
                    placeholder="Current password"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => { setSetupStep('idle'); setSecurityMsg(null); setDisablePassword(''); }}
                      className="btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button type="button"
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

              {/* Quick links to devices / history / keys */}
              <div className="flex gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: '1px solid #242a32' }}>
                <button type="button"
                  onClick={() => setSecurityView('keys')}
                  className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                  style={{ color: '#d97706', borderColor: '#d97706' }}
                >
                  Security Keys
                </button>
                <button type="button"
                  onClick={() => setSecurityView('devices')}
                  className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                >
                  Trusted Devices
                </button>
                <button type="button"
                  onClick={() => setSecurityView('history')}
                  className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                >
                  Login History
                </button>
              </div>
              </>
              )}
            </>
          )}

          {activeTab === 'sessions' && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#888888' }}>
                Active Sessions
              </div>
              {sessions.length === 0 ? (
                <div className="text-xs text-center py-4" style={{ color: '#666666' }}>No active sessions</div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session: any) => (
                    <div
                      key={session.session_id}
                      className="flex items-center justify-between p-2"
                      style={{ background: '#050505', border: '1px solid #242a32' }}
                    >
                      <div>
                        <div className="text-[11px] text-white font-mono">
                          {session.ip_address}
                        </div>
                        <div className="text-[9px]" style={{ color: '#666666' }}>
                          {session.user_agent?.substring(0, 60)}...
                        </div>
                        <div className="text-[9px]" style={{ color: '#666666' }}>
                          Last used: {(session.last_used_at || session.created_at) ? new Date(session.last_used_at || session.created_at).toLocaleString() : 'N/A'}
                        </div>
                      </div>
                      <button type="button"
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
                  <div className="panel-beveled p-3" style={{ background: '#0a0a0a' }}>
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">
                      Two-Factor Authentication
                    </h3>
                    {tfaStatus?.enabled ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="led-dot led-green" />
                          <span style={{ color: '#22c55e' }}>2FA is enabled</span>
                          <span className="text-[9px] ml-auto font-mono" style={{ color: '#666666' }}>
                            {tfaStatus.backupCodesRemaining} backup codes left
                          </span>
                        </div>
                        <button type="button"
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
                        <button type="button"
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
                    <button type="button"
                      onClick={() => setSecurityView('devices')}
                      className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
                    >
                      Trusted Devices
                    </button>
                    <button type="button"
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
                  <button type="button"
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#888888' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <TwoFactorSetupWizard
                    onComplete={() => {
                      setSecurityView('overview');
                      apiFetch<any>('/auth/2fa/status')
                        .then(data => setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }))
                        .catch((err) => { console.warn('[UserProfileModal] refresh 2FA status after setup failed:', err); });
                    }}
                    onCancel={() => setSecurityView('overview')}
                  />
                </div>
              )}

              {securityView === 'regen-backup' && (
                <div>
                  <button type="button"
                    onClick={() => { setSecurityView('overview'); setRegenCodes(null); }}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#888888' }}
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
                          .catch((err) => { console.warn('[UserProfileModal] refresh 2FA status after regen failed:', err); });
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
                          type="password" autoComplete="new-password"
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

                      <button type="button"
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
                  <button type="button"
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#888888' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <TrustedDevicesList />
                </div>
              )}

              {securityView === 'history' && (
                <div>
                  <button type="button"
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: '#888888' }}
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
