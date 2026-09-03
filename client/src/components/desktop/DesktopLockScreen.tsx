import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Eye, EyeOff, Shield, Loader2, ChevronLeft, Users, RefreshCw, AlertTriangle, WifiOff } from 'lucide-react';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';
import DesktopEmergencyAccessModal from './DesktopEmergencyAccessModal';
import { verifyOfflinePin } from '../../utils/DesktopOfflineAuthVault';

const AGENCY_NAME = 'Rocky Mountain Protective Group';
const AGENCY_SHORT = 'RMPG';
const MAX_ATTEMPTS = 5;
const LAST_USER_KEY = 'rmpg_last_login_user';

interface UserCard {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  badge_number?: string;
  role: string;
}

type UnlockMode = 'password' | 'pin';

export interface DesktopLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
}

function makeInitials(u: UserCard): string {
  return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase() || '?';
}

function roleLabel(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const AVATAR_PALETTE = ['#2d5a8c', '#3e74a8', '#1e4a72', '#4a6fa5', '#25527a', '#365e8c', '#2a4f7c'];
function avatarColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export default function DesktopLockScreen({ isLocked, onUnlock }: DesktopLockScreenProps) {
  const { time, date } = useClock();
  const { user, login } = useAuth();

  const [users, setUsers] = useState<UserCard[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserCard | null>(null);
  const [switchingUser, setSwitchingUser] = useState(false);

  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener for Ctrl+Alt+Shift+F12
  useEffect(() => {
    if (!isLocked) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'F12' || e.code === 'F12')) {
        e.preventDefault();
        setEmergencyModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isLocked]);

  useEffect(() => {
    if (!isLocked) return;
    setPassword('');
    setPin('');
    setError('');
    setSwitchingUser(false);

    const fromSession: UserCard | null = user
      ? { id: Number(user.id), username: user.username, first_name: user.first_name ?? '', last_name: user.last_name ?? '', badge_number: user.badge_number, role: user.role ?? '' }
      : null;

    if (fromSession) {
      try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(fromSession)); } catch { /* ignore */ }
      setSelectedUser(fromSession);
      return;
    }

    try {
      const saved = localStorage.getItem(LAST_USER_KEY);
      if (saved) { setSelectedUser(JSON.parse(saved)); return; }
    } catch { /* ignore */ }

    setSelectedUser(null);
  }, [isLocked, user]);

  useEffect(() => {
    if (selectedUser) setTimeout(() => inputRef.current?.focus(), 120);
  }, [selectedUser?.username]);

  const loadUsers = useCallback(() => {
    setUsersLoading(true);
    setUsersError('');
    setNetworkError('');
    apiFetch<{ users: UserCard[] }>('/auth/users/list')
      .then(res => setUsers(res.users ?? []))
      .catch(() => {
        setUsersError('Could not load user list');
        setNetworkError('Unable to reach server — check network connection');
      })
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    if (isLocked && (!selectedUser || switchingUser)) loadUsers();
  }, [isLocked, selectedUser, switchingUser, loadUsers]);

  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil;
  const lockoutSecsLeft = lockoutUntil ? Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000)) : 0;
  useEffect(() => {
    if (!lockoutUntil) return;
    const id = setInterval(() => {
      if (Date.now() >= lockoutUntil) { setLockoutUntil(null); setAttempts(0); setError(''); }
    }, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const handleFailedAttempt = useCallback(() => {
    const next = attempts + 1;
    setAttempts(next);
    if (next >= MAX_ATTEMPTS) {
      const lockMs = Math.min(30_000 * Math.pow(2, next - MAX_ATTEMPTS), 120_000);
      setLockoutUntil(Date.now() + lockMs);
      setError(`Too many attempts. Locked for ${lockMs / 1000}s.`);
    } else {
      setError(`Incorrect ${mode === 'password' ? 'password' : 'PIN'}. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next !== 1 ? 's' : ''} remaining.`);
    }
    setPassword('');
    setPin('');
    inputRef.current?.focus();
  }, [attempts, mode]);

  const handlePasswordUnlock = useCallback(async () => {
    if (!password.trim() || isLockedOut || !selectedUser) return;
    setBusy(true);
    setError('');
    setNetworkError('');
    try {
      const result = await login(selectedUser.username, password);
      if (result.success && !result.requires2FA) {
        setAttempts(0);
        setSwitchingUser(false);
        try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(selectedUser)); } catch { /* ignore */ }
        onUnlock();
      } else {
        handleFailedAttempt();
      }
    } catch {
      // Offline fallback verification
      const offlineRes = await verifyOfflinePin(selectedUser.username, password);
      if (offlineRes.ok) {
        setAttempts(0);
        onUnlock();
      } else {
        setNetworkError('Unable to reach server — check network connection');
        handleFailedAttempt();
      }
    } finally {
      setBusy(false);
    }
  }, [password, selectedUser, login, onUnlock, handleFailedAttempt, isLockedOut]);

  const handlePinUnlock = useCallback(async () => {
    if (pin.length < 4 || isLockedOut || !selectedUser) return;
    setBusy(true);
    setError('');
    setNetworkError('');
    try {
      const res = await apiFetch<{ ok: boolean }>('/auth/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ pin, username: selectedUser.username }),
      });
      if (res?.ok) { setAttempts(0); setSwitchingUser(false); onUnlock(); }
      else handleFailedAttempt();
    } catch {
      const offlineRes = await verifyOfflinePin(selectedUser.username, pin);
      if (offlineRes.ok) {
        setAttempts(0);
        onUnlock();
      } else {
        setNetworkError('Unable to reach server — check network connection');
        handleFailedAttempt();
      }
    } finally {
      setBusy(false);
    }
  }, [pin, selectedUser, onUnlock, handleFailedAttempt, isLockedOut]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'password') handlePasswordUnlock();
      else if (pin.length >= 4) handlePinUnlock();
    }
  }, [mode, pin, handlePasswordUnlock, handlePinUnlock]);

  const handleSwitchUser = useCallback(() => {
    setSwitchingUser(true);
    setSelectedUser(null);
    setPassword('');
    setPin('');
    setError('');
    setAttempts(0);
    setLockoutUntil(null);
    loadUsers();
  }, [loadUsers]);

  if (!isLocked) return null;

  // Determine current view
  const showPicker = !selectedUser || switchingUser;

  return (
    <div
      role="dialog"
      aria-label={showPicker ? 'FlexOS Login' : 'Screen locked'}
      aria-modal
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(160deg, var(--surface-sunken) 0%, var(--surface-raised) 60%, var(--surface-overlay) 100%)',
        backdropFilter: 'blur(20px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Arial, sans-serif', overflow: 'hidden',
      }}
    >
      {/* Subtle grid texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(var(--accent-silver-400-rgb),0.04) 1px, transparent 0)',
        backgroundSize: '32px 32px',
      }} />

      {/* Agency header */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 24px', borderBottom: '1px solid rgba(var(--accent-silver-400-rgb),0.07)', background: 'rgba(0 0 0 / 0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield style={{ width: 18, height: 18, color: 'var(--accent-silver-400)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--accent-silver-300)', textTransform: 'uppercase' }}>
            {AGENCY_SHORT} — {AGENCY_NAME}
          </span>
        </div>
      </div>

      {/* Clock */}
      <div style={{ textAlign: 'center', marginBottom: 40, position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 76, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </div>
        <div style={{ fontSize: 15, marginTop: 8, color: 'var(--text-secondary)', letterSpacing: '0.08em' }}>
          {date}
        </div>
      </div>

      {/* ── USER PICKER ── */}
      {showPicker ? (
        <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Users style={{ width: 14, height: 14, color: 'var(--accent-silver-400)' }} />
            <span style={{ fontSize: 12, color: 'var(--accent-silver-400)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
              Select Account
            </span>
          </div>

          {usersLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
              <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
              Loading users…
            </div>
          )}

          {usersError && (
            <div style={{ color: 'var(--sev-critical)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              {usersError}
              <button type="button" onClick={loadUsers} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent-silver-400)' }}>
                <RefreshCw style={{ width: 12, height: 12 }} />
              </button>
            </div>
          )}

          {!usersLoading && users.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(users.length, 4)}, 1fr)`,
              gap: 16, width: '100%',
            }}>
              {users.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { setSelectedUser(u); setSwitchingUser(false); }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                    padding: '20px 12px', background: 'rgba(var(--rmpg-800-rgb),0.4)',
                    border: '1px solid rgba(var(--accent-silver-400-rgb),0.12)',
                    cursor: 'pointer', transition: 'background 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.7)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.4)')}
                >
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: avatarColor(u.username),
                    border: '2px solid rgba(var(--accent-silver-400-rgb),0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em',
                  }}>
                    {makeInitials(u)}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                      {u.first_name} {u.last_name}
                    </div>
                    {u.badge_number && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Badge {u.badge_number}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {roleLabel(u.role)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!usersLoading && users.length === 0 && !usersError && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              No users found. Check network connection.
            </div>
          )}
        </div>
      ) : (
        /* ── CREDENTIAL CARD ── */
        <div style={{
          position: 'relative', zIndex: 1, width: 360,
          background: 'rgba(var(--rmpg-800-rgb),0.55)',
          border: '1px solid rgba(var(--accent-silver-400-rgb),0.15)',
          padding: '32px 28px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          backdropFilter: 'blur(8px)',
        }}>
          {/* Officer avatar */}
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: avatarColor(selectedUser!.username),
            border: '2px solid rgba(var(--accent-silver-400-rgb),0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.05em',
          }}>
            {makeInitials(selectedUser!)}
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
              {selectedUser!.first_name} {selectedUser!.last_name}
            </div>
            {selectedUser!.badge_number && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                Badge {selectedUser!.badge_number}
              </div>
            )}
          </div>

          {/* Mode switcher */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(var(--accent-silver-400-rgb),0.2)', width: '100%' }}>
            {(['password', 'pin'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(''); setPassword(''); setPin(''); setTimeout(() => inputRef.current?.focus(), 50); }}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontWeight: mode === m ? 600 : 400,
                  background: mode === m ? 'rgba(var(--rmpg-700-rgb),0.25)' : 'transparent',
                  color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em',
                }}
              >
                {m === 'password' ? 'Password' : 'PIN'}
              </button>
            ))}
          </div>

          {/* Input */}
          {mode === 'password' ? (
            <div style={{ width: '100%', position: 'relative' }}>
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Password"
                disabled={busy || isLockedOut}
                autoComplete="current-password"
                style={{
                  width: '100%', padding: '10px 40px 10px 12px', fontSize: 14,
                  background: 'rgba(var(--surface-sunken-rgb,10 20 40),0.5)',
                  border: error ? '1px solid var(--sev-critical)' : '1px solid rgba(var(--accent-silver-400-rgb),0.2)',
                  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-secondary)' }}
              >
                {showPassword ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}
              </button>
            </div>
          ) : (
            <input
              ref={inputRef}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={handleKeyDown}
              placeholder="Enter PIN"
              disabled={busy || isLockedOut}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 24, letterSpacing: '0.5em',
                textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                background: 'rgba(var(--surface-sunken-rgb,10 20 40),0.5)',
                border: error ? '1px solid var(--sev-critical)' : '1px solid rgba(var(--accent-silver-400-rgb),0.2)',
                color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
              }}
            />
          )}

          {/* Error */}
          {error && (
            <div style={{ width: '100%', fontSize: 11, color: 'var(--sev-critical)', textAlign: 'center' }}>
              {isLockedOut ? `Locked out — ${lockoutSecsLeft}s remaining` : error}
            </div>
          )}

          {/* Network Error Banner (matches media_1787226375289.jpg) */}
          {networkError && (
            <div style={{ width: '100%', fontSize: 12, color: '#f87171', fontWeight: 600, textAlign: 'center', marginTop: 2 }}>
              {networkError}
            </div>
          )}

          {/* Unlock button */}
          <button
            type="button"
            onClick={mode === 'password' ? handlePasswordUnlock : handlePinUnlock}
            disabled={busy || isLockedOut || (mode === 'password' ? !password : pin.length < 4)}
            style={{
              width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 600,
              background: 'rgba(var(--rmpg-700-rgb),0.7)', border: '1px solid rgba(var(--accent-silver-400-rgb),0.25)',
              color: 'var(--text-primary)', cursor: busy || isLockedOut ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: busy || isLockedOut ? 0.6 : 1,
            }}
          >
            {busy ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Verifying…</>
              : <><Lock style={{ width: 14, height: 14 }} /> Unlock</>}
          </button>

          {/* Switch user / Emergency Access prompt */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
            <button
              type="button"
              onClick={handleSwitchUser}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}
            >
              <ChevronLeft style={{ width: 11, height: 11 }} /> Switch user
            </button>

            <button
              type="button"
              onClick={() => setEmergencyModalOpen(true)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 10, cursor: 'pointer', letterSpacing: '0.04em', textDecoration: 'underline' }}
            >
              Press Ctrl+Alt+Shift+F12 for emergency access
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: 'rgba(var(--accent-silver-400-rgb),0.3)', letterSpacing: '0.06em' }}>
        Press Ctrl+Alt+Shift+F12 for emergency access | RMPG Flex — Secured Workstation
      </div>

      {/* Emergency Access Modal */}
      <DesktopEmergencyAccessModal
        isOpen={emergencyModalOpen}
        onClose={() => setEmergencyModalOpen(false)}
        onEmergencyUnlock={(reason, supervisorName) => {
          setEmergencyModalOpen(false);
          setAttempts(0);
          onUnlock();
        }}
      />
    </div>
  );
}
