import { useState, useEffect, useRef } from 'react';
import { toDisplayLabel, formatPhoneInput } from '../utils/formatters';
import { parseTimestamp } from '../utils/dateUtils';
import { lockBodyScroll, unlockBodyScroll } from '../utils/bodyScrollLock';
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
  RefreshCw,
  Camera,
  Trash2,
  Upload,
  Settings,
  Bell,
  Monitor,
  RotateCcw,
  Key,
  Volume2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import SignaturePad from './SignaturePad';
import TrustedDevicesList from './security/TrustedDevicesList';
import LoginHistoryTable from './security/LoginHistoryTable';
import { isNotificationSoundEnabled, setNotificationSoundEnabled } from '../utils/notificationTones';
import VoicePersonaSettings from './settings/VoicePersonaSettings';
import SecurityKeyManager from './security/SecurityKeyManager';
import BackupCodesDisplay from './security/BackupCodesDisplay';
import SecurityStatusCard from './security/SecurityStatusCard';
import TwoFactorSetupWizard from './security/TwoFactorSetupWizard';
import { applyThemePreference, normalizeThemePreference, writeThemeOverride, resolveCurrentTheme, readThemeOverride } from '../utils/theme';

/**
 * Per-user notification-sound toggle. Reads the current state via the
 * per-user helper (which falls back to the legacy global key) and writes
 * back through the helper so a shared MDT doesn't leak a former
 * operator's "off" pref into the next login.
 *
 * Kept inline (single use site) to avoid a separate file for what is
 * effectively a stateful wrapper around two existing utility calls.
 */
function NotificationSoundToggle() {
  const [enabled, setEnabled] = useState(() => isNotificationSoundEnabled());
  const onChange = (next: boolean) => {
    setEnabled(next);
    setNotificationSoundEnabled(next);
  };
  return (
    <div className="mt-3" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', padding: '8px 10px' }}>
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-[11px] text-rmpg-200">Enable Notification Sounds</span>
        <div className="flex items-center gap-2">
          <input
            id="ff-userprofilemodal-10"
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 accent-green-500"
          />
          <span
            className={`text-[9px] font-mono ${enabled ? 'text-green-400' : 'text-red-400'}`}
          >
            {enabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </label>
    </div>
  );
}

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
  initialTab?: 'profile' | 'password' | 'sessions' | 'security' | 'preferences' | 'voice';
}

export default function UserProfileModal({ isOpen, onClose, initialTab = 'profile' }: UserProfileModalProps) {
  const { user, logout, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Profile form
  const [username, setUsername] = useState('');
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
  const [pwPolicyLoaded, setPwPolicyLoaded] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

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
  const [securityView, setSecurityView] = useState<'overview' | 'devices' | 'history' | 'keys' | 'setup-2fa' | 'regen-backup'>('overview');

  // WebAuthn / Security Keys
  const [webauthnBusy, setWebauthnBusy] = useState(false);
  const [webauthnMsg, setWebauthnMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [showKeyNameInput, setShowKeyNameInput] = useState(false);

  // Security tab state (remote)
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; backupCodesRemaining: number } | null>(null);
  const [securityLoaded, setSecurityLoaded] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenError, setRegenError] = useState('');

  // Security questions ("Forgot password?" recovery setup)
  const [sqConfigured, setSqConfigured] = useState<boolean | null>(null);
  const [sqEditing, setSqEditing] = useState(false);
  const [sqQuestions, setSqQuestions] = useState<string[]>(['', '', '']);
  const [sqAnswers, setSqAnswers] = useState<string[]>(['', '', '']);
  const [sqCurrentPassword, setSqCurrentPassword] = useState('');
  const [sqBusy, setSqBusy] = useState(false);
  const [sqMsg, setSqMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Body scroll lock — prevent background scrolling when modal is open.
  // Position/top/width + scroll-position preservation now live inside
  // lockBodyScroll/unlockBodyScroll (reference-counted, nesting-safe) — see
  // bodyScrollLock.ts for why that state can't be owned per-component (two
  // modals open at once, e.g. a ConfirmDialog launched from inside this
  // modal, used to stomp on each other's document.body styles).
  useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && user) {
      setUsername(user.username || '');
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
    // Quickly switching tabs (security -> password -> security, etc.) used to
    // re-fire every one of these fetches on every visit with no cancellation,
    // so an old in-flight response for a tab the user had already left could
    // still land and flip that tab's state right as they switched back to
    // it — visible as a flicker. `cancelled` lets each effect run ignore its
    // own response once a newer run (tab switch, or unmount) has superseded
    // it, and the *Loaded guards stop the redundant re-fetch in the first
    // place for tabs whose data doesn't change per-visit.
    let cancelled = false;

    if (isOpen && activeTab === 'password' && !pwPolicyLoaded) {
      apiFetch<any>('/auth/password-policy')
        .then(data => { if (!cancelled) { setPwPolicy(Array.isArray(data?.policy) ? data.policy : []); setPwPolicyLoaded(true); } })
        .catch((err) => { console.warn('[UserProfileModal] fetch password policy failed:', err); });
    }
    if (isOpen && activeTab === 'sessions' && !sessionsLoaded) {
      apiFetch<any>('/auth/sessions')
        .then(data => { if (!cancelled) { setSessions(Array.isArray(data) ? data : []); setSessionsLoaded(true); } })
        .catch(() => { if (!cancelled) { setSessions([]); setSessionsLoaded(true); } });
    }
    if (isOpen && activeTab === 'security' && !securityLoaded) {
      apiFetch<any>('/auth/2fa/status')
        .then(data => { if (!cancelled) setTfaStatus({ enabled: data.enabled, backupCodesRemaining: data.backupCodesRemaining }); })
        .catch((err) => { console.warn('[UserProfileModal] fetch 2FA status failed:', err); });
      apiFetch<any>('/auth/security-questions')
        .then(data => { if (!cancelled) setSqConfigured(!!data.configured); })
        .catch((err) => { console.warn('[UserProfileModal] fetch security questions status failed:', err); if (!cancelled) setSqConfigured(null); })
        .finally(() => { if (!cancelled) setSecurityLoaded(true); });
      setSecurityView('overview');
      setRegenCodes(null);
      setRegenPassword('');
      setRegenError('');
      setSqEditing(false);
      setSqQuestions(['', '', '']);
      setSqAnswers(['', '', '']);
      setSqCurrentPassword('');
      setSqMsg(null);
    }
    if (isOpen && activeTab === 'preferences' && !prefsLoaded) {
      apiFetch<UserPreferences>('/user/preferences')
        .then(data => { if (!cancelled) { setPrefs(data); setPrefsLoaded(true); } })
        .catch(() => { if (!cancelled) setPrefsLoaded(true); });
    }

    return () => { cancelled = true; };
  }, [isOpen, activeTab, prefsLoaded, pwPolicyLoaded, sessionsLoaded, securityLoaded]);

  // Reset the per-visit *Loaded guards when the modal closes, so reopening
  // it (e.g. for a different admin action) fetches fresh data instead of
  // reusing a stale snapshot from the last time it was open.
  useEffect(() => {
    if (!isOpen) {
      setPwPolicyLoaded(false);
      setSessionsLoaded(false);
      setSecurityLoaded(false);
    }
  }, [isOpen]);

  if (!isOpen || !user) return null;

  const handleProfileSave = async () => {
    // Validate mandatory fields
    if (!firstName.trim() || !lastName.trim()) {
      setProfileMsg({ type: 'error', text: 'First and last name are required.' });
      return;
    }
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setProfileMsg({ type: 'error', text: 'Username is required.' });
      return;
    }
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const result = await apiFetch<{ token?: string; refreshToken?: string }>('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: trimmedUsername,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email,
          phone,
        }),
      });
      // Username changes invalidate the existing JWT (username claim moved).
      // The server re-issues a fresh token in the same response — swap it
      // into localStorage before refreshUser() so the next request carries
      // the new token instead of 401-ing.
      if (result?.token) {
        try { localStorage.setItem('rmpg_token', result.token); } catch { /* storage full */ }
      }
      if (result?.refreshToken) {
        try { localStorage.setItem('rmpg_refresh_token', result.refreshToken); } catch { /* storage full */ }
      }
      // Refresh AuthContext user so header/OPR name updates immediately
      await refreshUser();
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update profile' });
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
    } catch (err) {
      setPwMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
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
    { id: 'preferences' as const, label: 'Prefs', icon: Settings },
    { id: 'voice' as const, label: 'Voice', icon: Volume2 },
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
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Failed to regenerate codes');
    }
    setRegenLoading(false);
  };

  const handleSaveSecurityQuestions = async () => {
    if (!sqCurrentPassword) return;
    if (sqQuestions.some(q => !q.trim()) || sqAnswers.some(a => !a.trim())) return;
    setSqBusy(true);
    setSqMsg(null);
    try {
      await apiFetch<any>('/auth/security-questions', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: sqCurrentPassword,
          questions: sqQuestions,
          answers: sqAnswers,
        }),
      });
      setSqConfigured(true);
      setSqEditing(false);
      setSqQuestions(['', '', '']);
      setSqAnswers(['', '', '']);
      setSqCurrentPassword('');
      setSqMsg({ type: 'success', text: 'Security questions saved. You can now use "Forgot password?" on the login screen.' });
    } catch (err) {
      setSqMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save security questions' });
    }
    setSqBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose} role="presentation" style={{ touchAction: 'manipulation' }}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative w-[520px] max-w-[95vw] max-h-[80vh] flex flex-col"
        style={{
          background: 'var(--surface-overlay)',
          border: '1px solid var(--border-strong)',
          borderTopColor: 'var(--border-default)',
          borderLeftColor: 'var(--border-default)',
          borderBottomColor: 'var(--surface-raised)',
          borderRightColor: 'var(--surface-raised)',
          boxShadow: '0 8px 32px rgba(var(--surface-overlay-rgb) / 0.85)',
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
                background: 'linear-gradient(135deg, var(--surface-raised), var(--accent-silver-600))',
                color: 'var(--text-primary)',
                border: '2px solid var(--accent-silver-500)',
                borderRadius: 2,
              }}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="text-sm font-bold text-rmpg-100">
              {user.first_name} {user.last_name}
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {user.badge_number && <span className="mr-2">{user.badge_number}</span>}
              <span className="uppercase">{toDisplayLabel(user.role)}</span>
            </div>
            <div className="text-[10px] text-fg-muted">
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
                  color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent-silver-500)' : '2px solid transparent',
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {activeTab === 'profile' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-userprofilemodal-0" className="field-label">First Name <span className="text-red-500">*</span></label>
                  <input id="ff-userprofilemodal-0"
                    type="text"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="input-dark"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ff-userprofilemodal-1" className="field-label">Last Name <span className="text-red-500">*</span></label>
                  <input id="ff-userprofilemodal-1"
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="input-dark"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-userprofilemodal-2" className="field-label">Email</label>
                <input id="ff-userprofilemodal-2"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input-dark"
                />
              </div>
              <div>
                <label htmlFor="ff-userprofilemodal-3" className="field-label">Phone</label>
                <input id="ff-userprofilemodal-3"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(formatPhoneInput(e.target.value))}
                  className="input-dark"
                  placeholder="(555) 555-5555"
                />
              </div>

              {/* Username (editable) + Badge # (read-only) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label htmlFor="ff-userprofilemodal-4" className="field-label">Username *</label>
                  <input id="ff-userprofilemodal-4"
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="input-dark"
                    autoComplete="username"
                    spellCheck={false}
                    pattern="[a-zA-Z0-9_.\-]+"
                    minLength={3}
                  />
                  <div className="text-[9px] text-rmpg-400 mt-0.5">
                    Letters, numbers, _ . - · 3+ chars · session stays active after change
                  </div>
                </div>
                <div>
                  <label htmlFor="ff-userprofilemodal-14" className="field-label">Badge #</label>
                  <div className="text-xs text-rmpg-100 px-3 py-1.5" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)' }}>
                    {user.badge_number || '—'}
                  </div>
                </div>
              </div>

              {/* Profile Photo Upload */}
              <div className="mt-3 pt-3 border-t border-rmpg-700">
                <label htmlFor="ff-userprofilemodal-13" className="field-label flex items-center gap-1.5 mb-2">
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
                          background: 'linear-gradient(135deg, var(--surface-raised), var(--accent-silver-600))',
                          color: 'var(--text-primary)',
                          border: '2px solid var(--border-default)',
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
                        borderColor: imageDragOver ? 'var(--accent-silver-500)' : 'var(--border-subtle)',
                        background: imageDragOver ? 'rgba(136, 136, 136, 0.12)' : 'var(--surface-overlay)',
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
                      <Upload style={{ width: 16, height: 16, margin: '0 auto 4px', color: 'var(--text-muted)' }} />
                      <div className="text-[10px] text-fg-muted">
                        {imageUploading ? 'Uploading...' : 'Drop image here or click to browse'}
                      </div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        JPG, PNG, WebP — max 2MB
                      </div>
                    </div>
                    {profileImage && (
                      <button type="button"
                        onClick={handleRemoveProfileImage}
                        disabled={imageUploading}
                                                className="flex items-center gap-1 text-[10px] px-2 py-1 hover:text-red-400 transition-colors text-fg-muted"
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

          {activeTab === 'voice' && (
            <VoicePersonaSettings />
          )}

          {activeTab === 'password' && (
            <>
              <div>
                <label htmlFor="ff-userprofilemodal-5" className="field-label">Current Password</label>
                <div className="relative">
                  <input id="ff-userprofilemodal-5"
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="input-dark pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted"
                  >
                    {showCurrentPw ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="ff-userprofilemodal-6" className="field-label">New Password</label>
                <div className="relative">
                  <input id="ff-userprofilemodal-6"
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    className="input-dark pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(!showNewPw)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted"
                  >
                    {showNewPw ? <EyeOff style={{ width: 13, height: 13 }} /> : <Eye style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="ff-userprofilemodal-7" className="field-label">Confirm New Password</label>
                <input id="ff-userprofilemodal-7"
                  type="password" autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="input-dark"
                />
              </div>

              {pwPolicy.length > 0 && (
                <div className="text-[10px] space-y-0.5 p-2" style={{ color: 'var(--text-muted)', background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)' }}>
                  <div className="font-bold text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
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
                <div className="text-xs text-center py-4 text-fg-muted">Loading preferences...</div>
              ) : prefs ? (
                <>
                  {/* Notification Preferences */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Bell style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Notification Preferences
                      </span>
                    </div>
                    <div className="space-y-1.5" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)', padding: '8px 10px' }}>
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
                              <input id="ff-userprofilemodal-8"
                                type="checkbox"
                                checked={!!prefs[`notify_${key}_inapp`]}
                                onChange={e => setPrefs({ ...prefs, [`notify_${key}_inapp`]: e.target.checked ? 1 : 0 })}
                                className="w-3 h-3"
                              />
                              <span className="text-[9px] text-fg-muted">In-App</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input id="ff-userprofilemodal-9"
                                type="checkbox"
                                checked={!!prefs[`notify_${key}_email`]}
                                onChange={e => setPrefs({ ...prefs, [`notify_${key}_email`]: e.target.checked ? 1 : 0 })}
                                className="w-3 h-3"
                              />
                              <span className="text-[9px] text-fg-muted">Email</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Feature 23: Notification sound toggle.
                      v1056: routed through the per-user notificationTones
                      helpers so a shared MDT no longer inherits the previous
                      operator's "off" pref. */}
                  <NotificationSoundToggle />


                  {/* Quiet Hours */}
                  <div className="mt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Quiet Hours (Suppress Notifications)
                    </span>
                    <div className="grid grid-cols-2 gap-2 mt-1.5">
                      <div>
                        <label htmlFor="ff-userprofilemodal-11" className="field-label">Start</label>
                        <input id="ff-userprofilemodal-11"
                          type="time"
                          value={prefs.quiet_hours_start || ''}
                          onChange={e => setPrefs({ ...prefs, quiet_hours_start: e.target.value || null })}
                          className="input-dark text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="ff-userprofilemodal-12" className="field-label">End</label>
                        <input id="ff-userprofilemodal-12"
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
                      <Monitor style={{ width: 11, height: 11, color: 'var(--text-muted)' }} />
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        Display Settings
                      </span>
                    </div>
                    <div className="space-y-2">
                      {/* Feature 32: Dark/Light Theme Toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Theme</span>
                        <select id="ff-userprofilemodal-13"
                          value={(() => { const o = readThemeOverride(); return o?.active ? o.theme : 'auto'; })()}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === 'auto') {
                              writeThemeOverride({ theme: 'dark', active: false });
                              applyThemePreference(resolveCurrentTheme(), { persist: false });
                            } else {
                              const theme = normalizeThemePreference(v);
                              writeThemeOverride({ theme, active: true });
                              setPrefs({ ...prefs, theme_preference: theme });
                              applyThemePreference(theme);
                            }
                          }}
                          className="input-dark text-[10px] py-0.5 px-1 w-24"
                        >
                          <option value="auto">Auto (shift)</option>
                          <option value="dark">Night</option>
                          <option value="light">Day</option>
                        </select>
                      </div>
                      {/* Time Zone is fixed to Mountain Time (Utah) for all users —
                          intentionally not a setting. */}
                      {/* Feature 33: Font Size Adjustment */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Font Size</span>
                        <select id="ff-userprofilemodal-14"
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
                          <input id="ff-userprofilemodal-15"
                            type="range"
                            min="0.8"
                            max="1.4"
                            step="0.1"
                            value={prefs.font_scale}
                            onChange={e => setPrefs({ ...prefs, font_scale: parseFloat(e.target.value) })}
                            className="w-24 h-1"
                          />
                          <span className="text-[10px] font-mono w-8 text-right text-fg-muted">
                            {(prefs.font_scale * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Compact Mode</span>
                        <input id="ff-userprofilemodal-16"
                          type="checkbox"
                          checked={!!prefs.compact_mode}
                          onChange={e => setPrefs({ ...prefs, compact_mode: e.target.checked ? 1 : 0 })}
                          className="w-3 h-3"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Map Labels</span>
                        <input id="ff-userprofilemodal-17"
                          type="checkbox"
                          checked={!!prefs.show_map_labels}
                          onChange={e => setPrefs({ ...prefs, show_map_labels: e.target.checked ? 1 : 0 })}
                          className="w-3 h-3"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Default Map Style</span>
                        <select id="ff-userprofilemodal-18"
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
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Dispatch Board
                    </span>
                    <div className="space-y-2 mt-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-rmpg-200">Default Sort</span>
                        <select id="ff-userprofilemodal-19"
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
                        <input id="ff-userprofilemodal-20"
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
                                            className="flex items-center gap-1 text-[10px] px-2 py-1 transition-colors text-fg-muted"
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
                <div className="text-xs text-center py-4 text-fg-muted">Failed to load preferences</div>
              )}
            </>
          )}

          {activeTab === 'sessions' && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Active Sessions
              </div>
              {sessions.length === 0 ? (
                <div className="text-xs text-center py-4 text-fg-muted">No active sessions</div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session: any) => (
                    <div
                      key={session.session_id}
                      className="flex items-center justify-between p-2"
                      style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)' }}
                    >
                      <div>
                        <div className="text-[11px] text-rmpg-100 font-mono">
                          {session.ip_address}
                        </div>
                        <div className="text-[9px] text-fg-muted">
                          {session.user_agent?.substring(0, 60)}...
                        </div>
                        <div className="text-[9px] text-fg-muted">
                          Last used: {(session.last_used_at || session.created_at) ? parseTimestamp(session.last_used_at || session.created_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) : 'N/A'}
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
                  <div className="panel-beveled p-3" style={{ background:"var(--surface-sunken)" }}>
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">
                      Two-Factor Authentication
                    </h3>
                    {tfaStatus?.enabled ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="led-dot led-green" />
                          <span style={{ color: 'var(--sev-ok)' }}>2FA is enabled</span>
                          <span className="text-[9px] ml-auto font-mono text-fg-muted">
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
                          <span style={{ color: 'var(--sev-critical)' }}>2FA is not enabled</span>
                        </div>
                        <button type="button"
                          onClick={() => setSecurityView('setup-2fa')}
                          className="toolbar-btn toolbar-btn-primary w-full h-7 text-rmpg-100 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
                        >
                          <Shield className="w-3 h-3" />
                          Set Up 2FA Now
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Security questions — "Forgot password?" recovery setup */}
                  <div className="panel-beveled p-3" style={{ background: "var(--surface-sunken)" }}>
                    <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-3">
                      Password Recovery Questions
                    </h3>

                    {sqMsg && (
                      <div className={`flex items-center gap-2 px-3 py-2 text-[10px] mb-3 ${sqMsg.type === 'success' ? 'text-green-400 bg-green-900/20 border border-green-800/40' : 'text-red-400 bg-red-900/20 border border-red-800/40'}`}>
                        {sqMsg.type === 'success' ? <Check style={{ width: 12, height: 12 }} /> : <AlertCircle style={{ width: 12, height: 12 }} />}
                        {sqMsg.text}
                      </div>
                    )}

                    {!sqEditing ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className={`led-dot ${sqConfigured ? 'led-green' : 'led-red'}`} />
                          <span style={{ color: sqConfigured ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>
                            {sqConfigured ? 'Recovery questions are set up' : 'Recovery questions are not set up'}
                          </span>
                        </div>
                        <p className="text-[9px] text-fg-muted">
                          {sqConfigured
                            ? 'Answering these lets you reset your password from the login screen without an administrator.'
                            : 'Without these, "Forgot password?" cannot recover your account — an administrator must reset it manually.'}
                        </p>
                        <button type="button"
                          onClick={() => {
                            setSqEditing(true);
                            setSqMsg(null);
                            setSqQuestions(['', '', '']);
                            setSqAnswers(['', '', '']);
                            setSqCurrentPassword('');
                          }}
                          className="toolbar-btn w-full h-7 text-[10px] uppercase tracking-wider"
                        >
                          {sqConfigured ? 'Update Recovery Questions' : 'Set Up Recovery Questions'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="space-y-1">
                            <label htmlFor={`ff-userprofilemodal-sq-q${i}`} className="field-label">
                              Question {i + 1}
                            </label>
                            <input id={`ff-userprofilemodal-sq-q${i}`}
                              type="text"
                              value={sqQuestions[i]}
                              onChange={e => setSqQuestions(prev => prev.map((q, idx) => idx === i ? e.target.value : q))}
                              className="input-dark"
                              placeholder="e.g. What was your first pet's name?"
                            />
                            <input id={`ff-userprofilemodal-sq-a${i}`}
                              type="text" autoComplete="off"
                              value={sqAnswers[i]}
                              onChange={e => setSqAnswers(prev => prev.map((a, idx) => idx === i ? e.target.value : a))}
                              className="input-dark"
                              placeholder="Answer"
                            />
                          </div>
                        ))}
                        <div className="space-y-1 pt-1">
                          <label htmlFor="ff-userprofilemodal-sq-pw" className="field-label">Current Password</label>
                          <input id="ff-userprofilemodal-sq-pw"
                            type="password" autoComplete="new-password"
                            value={sqCurrentPassword}
                            onChange={e => setSqCurrentPassword(e.target.value)}
                            className="input-dark"
                            placeholder="Confirm it's you"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="button"
                            onClick={() => { setSqEditing(false); setSqMsg(null); }}
                            className="btn-secondary flex-1"
                          >
                            Cancel
                          </button>
                          <button type="button"
                            onClick={handleSaveSecurityQuestions}
                            disabled={sqBusy || !sqCurrentPassword || sqQuestions.some(q => !q.trim()) || sqAnswers.some(a => !a.trim())}
                            className="btn-primary flex-1"
                          >
                            {sqBusy ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick links */}
                  <div className="flex gap-2 flex-wrap">
                    <button type="button"
                      onClick={() => setSecurityView('keys')}
                      className="toolbar-btn flex-1 h-7 text-[10px] uppercase tracking-wider"
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
                </div>
              )}

              {securityView === 'keys' && (
                <div>
                  <button type="button"
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ← Back to Security Overview
                  </button>
                  <SecurityKeyManager />
                </div>
              )}

              {securityView === 'setup-2fa' && (
                <div>
                  <button type="button"
                    onClick={() => setSecurityView('overview')}
                    className="text-[10px] mb-3 flex items-center gap-1"
                    style={{ color: 'var(--text-muted)' }}
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
                    style={{ color: 'var(--text-muted)' }}
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
                        style={{ background: 'rgba(var(--accent-silver-400-rgb) / 0.12)', border: '1px solid rgba(var(--accent-silver-400-rgb) / 0.4)', color: 'var(--accent-silver-400)' }}
                      >
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>This will invalidate all existing backup codes. Enter your password to confirm.</span>
                      </div>

                      <div>
                        <label htmlFor="ff-userprofilemodal-22" className="field-label">Current Password</label>
                        <input id="ff-userprofilemodal-22"
                          type="password" autoComplete="new-password"
                          value={regenPassword}
                          onChange={e => setRegenPassword(e.target.value)}
                          className="input-dark"
                          placeholder="Enter your password"
                        />
                      </div>

                      {regenError && (
                        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--sev-critical)' }}>
                          <AlertCircle className="w-3 h-3" />
                          {regenError}
                        </div>
                      )}

                      <button type="button"
                        onClick={handleRegenBackupCodes}
                        disabled={!regenPassword || regenLoading}
                        className="toolbar-btn toolbar-btn-primary w-full h-8 text-rmpg-100 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
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
                    style={{ color: 'var(--text-muted)' }}
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
                    style={{ color: 'var(--text-muted)' }}
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
