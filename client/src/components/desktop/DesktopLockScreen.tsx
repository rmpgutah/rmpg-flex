import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Eye, EyeOff, Shield, Loader2, ChevronLeft, Users, RefreshCw, Wifi, WifiOff, Activity } from 'lucide-react';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';
import DesktopEmergencyAccessModal from './DesktopEmergencyAccessModal';
import { verifyOfflinePin } from '../../utils/DesktopOfflineAuthVault';

const AGENCY_NAME = 'Rocky Mountain Protective Group';
const AGENCY_SHORT = 'RMPG';
const MAX_ATTEMPTS = 5;
const LAST_USER_KEY = 'rmpg_last_login_user';
const PIN_MAX_LEN = 6;
const PIN_MIN_LEN = 4;

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

const AVATAR_BLUES = ['#2d5a8c', '#3e74a8', '#1e4a72', '#4a6fa5', '#25527a', '#365e8c', '#2a4f7c'];
function avatarColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return AVATAR_BLUES[h % AVATAR_BLUES.length];
}

function getFocusableEls(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}

const NUMPAD_KEYS: { label: string; value: string }[] = [
  { label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' },
  { label: '4', value: '4' }, { label: '5', value: '5' }, { label: '6', value: '6' },
  { label: '7', value: '7' }, { label: '8', value: '8' }, { label: '9', value: '9' },
  { label: '⌫', value: 'backspace' }, { label: '0', value: '0' }, { label: '↵', value: 'enter' },
];

export default function DesktopLockScreen({ isLocked, onUnlock }: DesktopLockScreenProps) {
  const { time, date } = useClock();
  const { user, login } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // User picker
  const [users, setUsers] = useState<UserCard[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserCard | null>(null);
  const [switchingUser, setSwitchingUser] = useState(false);

  // Auth
  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecsLeft, setLockoutSecsLeft] = useState(0);
  const [lockoutTotalSecs, setLockoutTotalSecs] = useState(30);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  // Live status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [activeCalls, setActiveCalls] = useState<number | null>(null);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (!isLocked) return;
    let dead = false;
    const poll = () => {
      apiFetch<{ count?: number; total?: number }>('/dispatch/calls?status=active&limit=1')
        .then(r => { if (!dead) setActiveCalls(r?.count ?? r?.total ?? 0); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => { dead = true; clearInterval(id); };
  }, [isLocked]);

  // Emergency shortcut
  useEffect(() => {
    if (!isLocked) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.shiftKey && (e.key === 'F12' || e.code === 'F12')) {
        e.preventDefault(); setEmergencyOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isLocked]);

  // PIN keyboard capture
  useEffect(() => {
    if (!isLocked || mode !== 'pin') return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key) && pin.length < PIN_MAX_LEN) {
        setPin(p => p + e.key); setError('');
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isLocked, mode, pin]);

  // Focus trap
  useEffect(() => {
    if (!isLocked || emergencyOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !containerRef.current) return;
      const els = getFocusableEls(containerRef.current);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isLocked, emergencyOpen]);

  // Reset on lock
  useEffect(() => {
    if (!isLocked) return;
    setPassword(''); setPin(''); setError(''); setNetworkError(''); setSwitchingUser(false);
    const fromSession: UserCard | null = user
      ? { id: Number(user.id), username: user.username, first_name: user.first_name ?? '', last_name: user.last_name ?? '', badge_number: user.badge_number, role: user.role ?? '' }
      : null;
    if (fromSession) {
      try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(fromSession)); } catch { /* */ }
      setSelectedUser(fromSession); return;
    }
    try { const s = localStorage.getItem(LAST_USER_KEY); if (s) { setSelectedUser(JSON.parse(s)); return; } } catch { /* */ }
    setSelectedUser(null);
  }, [isLocked, user]);

  // Auto-focus password
  useEffect(() => {
    if (selectedUser && mode === 'password') {
      const t = setTimeout(() => passwordRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [selectedUser?.username, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsers = useCallback(() => {
    setUsersLoading(true); setUsersError('');
    apiFetch<{ users: UserCard[] }>('/auth/users/list')
      .then(r => setUsers(r.users ?? []))
      .catch(() => setUsersError('Could not load accounts — check network'))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    if (isLocked && (!selectedUser || switchingUser)) loadUsers();
  }, [isLocked, selectedUser, switchingUser, loadUsers]);

  // Lockout countdown
  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil;
  useEffect(() => {
    if (!lockoutUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutSecsLeft(left);
      if (Date.now() >= lockoutUntil) { setLockoutUntil(null); setAttempts(0); setError(''); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const handleFailedAttempt = useCallback(() => {
    const next = attempts + 1;
    setAttempts(next);
    if (next >= MAX_ATTEMPTS) {
      const lockSecs = Math.min(30 * Math.pow(2, next - MAX_ATTEMPTS), 120);
      setLockoutTotalSecs(lockSecs);
      setLockoutUntil(Date.now() + lockSecs * 1000);
      setError(`Locked ${lockSecs}s — ${MAX_ATTEMPTS} failed attempts.`);
    } else {
      setError(`Incorrect ${mode === 'password' ? 'password' : 'PIN'}. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next !== 1 ? 's' : ''} remaining.`);
    }
    setPassword(''); setPin('');
  }, [attempts, mode]);

  const handlePasswordUnlock = useCallback(async () => {
    if (!password.trim() || isLockedOut || !selectedUser || busy) return;
    setBusy(true); setError(''); setNetworkError('');
    try {
      const r = await login(selectedUser.username, password);
      if (r.success && !r.requires2FA) {
        setAttempts(0); setSwitchingUser(false);
        try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(selectedUser)); } catch { /* */ }
        onUnlock();
      } else handleFailedAttempt();
    } catch {
      const off = await verifyOfflinePin(selectedUser.username, password);
      if (off.ok) { setAttempts(0); onUnlock(); }
      else { setNetworkError('Unable to reach server — offline auth attempted'); handleFailedAttempt(); }
    } finally { setBusy(false); }
  }, [password, selectedUser, login, onUnlock, handleFailedAttempt, isLockedOut, busy]);

  const doSubmitPin = useCallback(async (pinVal: string) => {
    if (pinVal.length < PIN_MIN_LEN || isLockedOut || !selectedUser || busy) return;
    setBusy(true); setError(''); setNetworkError('');
    try {
      const r = await apiFetch<{ ok: boolean }>('/auth/verify-pin', {
        method: 'POST', body: JSON.stringify({ pin: pinVal, username: selectedUser.username }),
      });
      if (r?.ok) { setAttempts(0); setSwitchingUser(false); onUnlock(); }
      else handleFailedAttempt();
    } catch {
      const off = await verifyOfflinePin(selectedUser.username, pinVal);
      if (off.ok) { setAttempts(0); onUnlock(); }
      else { setNetworkError('Unable to reach server — offline auth attempted'); handleFailedAttempt(); }
    } finally { setBusy(false); }
  }, [isLockedOut, selectedUser, onUnlock, handleFailedAttempt, busy]);

  const handleNumpadPress = useCallback((val: string) => {
    if (isLockedOut || busy) return;
    if (val === 'backspace') { setPin(p => p.slice(0, -1)); setError(''); }
    else if (val === 'enter') { if (pin.length >= PIN_MIN_LEN) doSubmitPin(pin); }
    else if (/^\d$/.test(val) && pin.length < PIN_MAX_LEN) {
      const next = pin + val;
      setPin(next); setError('');
      if (next.length === PIN_MAX_LEN) doSubmitPin(next);
    }
  }, [isLockedOut, busy, pin, doSubmitPin]);

  const handleSwitchUser = useCallback(() => {
    setSwitchingUser(true); setSelectedUser(null);
    setPassword(''); setPin(''); setError(''); setAttempts(0); setLockoutUntil(null);
    loadUsers();
  }, [loadUsers]);

  if (!isLocked) return null;
  const showPicker = !selectedUser || switchingUser;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal
      aria-label={showPicker ? 'FlexOS — Select Officer' : `Screen locked — ${selectedUser?.first_name ?? ''} ${selectedUser?.last_name ?? ''}`}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(140deg, var(--surface-sunken) 0%, var(--surface-base) 55%, var(--surface-raised) 100%)',
        display: 'flex', fontFamily: 'Arial, sans-serif', overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Grid texture */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(var(--accent-silver-400-rgb),0.04) 1px, transparent 0)',
        backgroundSize: '36px 36px',
      }} />

      {/* ── LEFT PANEL ── */}
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        padding: '40px 52px', position: 'relative', zIndex: 1, justifyContent: 'space-between',
      }}>
        {/* Agency branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Shield style={{ width: 32, height: 32, color: 'var(--accent-silver-400)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.20em', color: 'var(--accent-silver-400)', textTransform: 'uppercase' }}>
              {AGENCY_SHORT}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.10em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {AGENCY_NAME}
            </div>
          </div>
        </div>

        {/* Clock */}
        <div>
          <div style={{
            fontSize: 88, fontWeight: 200, letterSpacing: '-0.03em', lineHeight: 1,
            color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums',
          }}>
            {time}
          </div>
          <div style={{ fontSize: 17, marginTop: 12, color: 'var(--text-secondary)', letterSpacing: '0.06em', fontWeight: 300 }}>
            {date}
          </div>
        </div>

        {/* Status indicators */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: isOnline ? 'var(--sev-ok)' : 'var(--sev-critical)',
            }} />
            {isOnline
              ? <Wifi style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
              : <WifiOff style={{ width: 12, height: 12, color: 'var(--sev-critical)' }} />}
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
              {isOnline ? 'Network connected' : 'Offline — offline auth available'}
            </span>
          </div>
          {activeCalls !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: activeCalls > 0 ? 'var(--sev-warn)' : 'var(--accent-silver-400)',
              }} />
              <Activity style={{ width: 12, height: 12, color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
                {activeCalls > 0 ? `${activeCalls} active dispatch call${activeCalls !== 1 ? 's' : ''}` : 'No active dispatch calls'}
              </span>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 10, color: 'rgba(var(--accent-silver-400-rgb),0.35)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            FlexOS · Secured Workstation
          </div>
        </div>
      </div>

      {/* Vertical divider */}
      <div style={{ width: 1, background: 'rgba(var(--accent-silver-400-rgb),0.09)', flexShrink: 0, position: 'relative', zIndex: 1 }} />

      {/* ── RIGHT PANEL ── */}
      <div style={{
        width: showPicker ? 560 : 400, flexShrink: 0, position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(var(--rmpg-800-rgb),0.18)',
        overflowY: 'auto',
        transition: 'width 200ms ease',
      }}>
        {showPicker ? (
          /* ── USER PICKER ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 32px', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users style={{ width: 14, height: 14, color: 'var(--accent-silver-400)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-silver-400)' }}>
                Select Account
              </span>
            </div>

            {usersLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
                Loading accounts…
              </div>
            )}
            {usersError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--sev-critical)' }}>
                <span>{usersError}</span>
                <button type="button" onClick={loadUsers} aria-label="Retry" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-silver-400)', padding: 4 }}>
                  <RefreshCw style={{ width: 12, height: 12 }} />
                </button>
              </div>
            )}
            {!usersLoading && users.length === 0 && !usersError && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No accounts found. Check network connection.</div>
            )}

            {!usersLoading && users.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {users.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setSelectedUser(u); setSwitchingUser(false); }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                      padding: '20px 12px', cursor: 'pointer', borderRadius: 2,
                      background: 'rgba(var(--rmpg-800-rgb),0.4)',
                      border: '1px solid rgba(var(--accent-silver-400-rgb),0.13)',
                      transition: 'background 120ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--rmpg-700-rgb),0.5)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.4)')}
                  >
                    <div style={{
                      width: 52, height: 52, borderRadius: '50%',
                      background: avatarColor(u.username),
                      border: '2px solid rgba(var(--accent-silver-400-rgb),0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em',
                    }}>
                      {makeInitials(u)}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {u.first_name} {u.last_name}
                      </div>
                      {u.badge_number && (
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>Badge {u.badge_number}</div>
                      )}
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {roleLabel(u.role)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setEmergencyOpen(true)}
              style={{ marginTop: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', letterSpacing: '0.05em', textDecoration: 'underline', textAlign: 'center', padding: '8px 0' }}
            >
              Emergency access (Ctrl+Alt+Shift+F12)
            </button>
          </div>
        ) : (
          /* ── AUTH CARD ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 28px', gap: 18 }}>
            {/* Avatar */}
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: avatarColor(selectedUser!.username),
              border: '2px solid rgba(var(--accent-silver-400-rgb),0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em', flexShrink: 0,
            }}>
              {makeInitials(selectedUser!)}
            </div>

            {/* Name & badge */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {selectedUser!.first_name} {selectedUser!.last_name}
              </div>
              {selectedUser!.badge_number && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Badge {selectedUser!.badge_number}</div>
              )}
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {roleLabel(selectedUser!.role)}
              </div>
            </div>

            {/* Attempt indicator dots */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: i < attempts ? 'var(--sev-critical)' : 'rgba(var(--accent-silver-400-rgb),0.2)',
                    transition: 'background 200ms',
                  }}
                />
              ))}
              {attempts > 0 && !isLockedOut && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>
                  {MAX_ATTEMPTS - attempts} left
                </span>
              )}
            </div>

            {/* Lockout countdown */}
            {isLockedOut && (
              <div style={{ width: '100%' }}>
                <div style={{ fontSize: 12, color: 'var(--sev-critical)', textAlign: 'center', marginBottom: 8, fontWeight: 600 }}>
                  Locked — {lockoutSecsLeft}s remaining
                </div>
                <div style={{ width: '100%', height: 3, background: 'rgba(var(--accent-silver-400-rgb),0.1)', borderRadius: 2 }}>
                  <div style={{
                    height: '100%', borderRadius: 2, background: 'var(--sev-critical)',
                    width: `${Math.min(100, (lockoutSecsLeft / lockoutTotalSecs) * 100)}%`,
                    transition: 'width 900ms linear',
                  }} />
                </div>
              </div>
            )}

            {/* Mode tabs */}
            <div style={{ display: 'flex', width: '100%', border: '1px solid rgba(var(--accent-silver-400-rgb),0.18)', borderRadius: 2, overflow: 'hidden' }}>
              {(['password', 'pin'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  disabled={isLockedOut}
                  onClick={() => {
                    setMode(m); setError(''); setPassword(''); setPin('');
                    if (m === 'password') setTimeout(() => passwordRef.current?.focus(), 60);
                  }}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 11, fontWeight: mode === m ? 700 : 400,
                    background: mode === m ? 'rgba(var(--rmpg-700-rgb),0.3)' : 'transparent',
                    color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                    border: 'none', cursor: isLockedOut ? 'default' : 'pointer',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}
                >
                  {m === 'password' ? 'Password' : 'PIN'}
                </button>
              ))}
            </div>

            {/* Password input */}
            {mode === 'password' && (
              <div style={{ width: '100%', position: 'relative' }}>
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handlePasswordUnlock(); }}
                  placeholder="Password"
                  disabled={busy || isLockedOut}
                  autoComplete="current-password"
                  style={{
                    width: '100%', padding: '10px 40px 10px 12px', fontSize: 14, boxSizing: 'border-box',
                    background: 'rgba(var(--rmpg-800-rgb),0.5)',
                    border: `1px solid ${error ? 'var(--sev-critical)' : 'rgba(var(--accent-silver-400-rgb),0.2)'}`,
                    color: 'var(--text-primary)', outline: 'none', borderRadius: 2,
                  }}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}
                >
                  {showPassword ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}
                </button>
              </div>
            )}

            {/* PIN dots + numpad */}
            {mode === 'pin' && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                {/* PIN dot display */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '6px 0' }}>
                  {Array.from({ length: PIN_MAX_LEN }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        width: 14, height: 14, borderRadius: '50%',
                        background: i < pin.length ? 'var(--accent-silver-400)' : 'transparent',
                        border: `2px solid ${error ? 'var(--sev-critical)' : i < pin.length ? 'var(--accent-silver-400)' : 'rgba(var(--accent-silver-400-rgb),0.35)'}`,
                        transition: 'background 100ms, border-color 100ms',
                      }}
                    />
                  ))}
                </div>

                {/* Numpad grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, width: '100%' }}>
                  {NUMPAD_KEYS.map(k => {
                    const isAction = k.value === 'backspace' || k.value === 'enter';
                    const isDisabled = isLockedOut || busy
                      || (k.value === 'enter' && pin.length < PIN_MIN_LEN)
                      || (!isAction && pin.length >= PIN_MAX_LEN);
                    return (
                      <button
                        key={k.value}
                        type="button"
                        aria-label={k.value === 'backspace' ? 'Delete digit' : k.value === 'enter' ? 'Submit PIN' : `Digit ${k.label}`}
                        onClick={() => handleNumpadPress(k.value)}
                        disabled={isDisabled}
                        style={{
                          height: 56, fontSize: isAction ? 18 : 22, fontWeight: isAction ? 400 : 500,
                          background: 'rgba(var(--rmpg-800-rgb),0.45)',
                          border: '1px solid rgba(var(--accent-silver-400-rgb),0.14)',
                          borderRadius: 2, cursor: isDisabled ? 'default' : 'pointer',
                          color: 'var(--text-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          opacity: isDisabled ? 0.35 : 1,
                          transition: 'background 80ms, opacity 150ms',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                        onMouseDown={e => { if (!isDisabled) e.currentTarget.style.background = 'rgba(var(--rmpg-700-rgb),0.65)'; }}
                        onMouseUp={e => { e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.45)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--rmpg-800-rgb),0.45)'; }}
                      >
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Error */}
            {(error || networkError) && !isLockedOut && (
              <div style={{ width: '100%', fontSize: 11, color: 'var(--sev-critical)', textAlign: 'center', lineHeight: 1.4 }}>
                {error || networkError}
              </div>
            )}

            {/* Unlock button (password mode only — PIN uses numpad ↵) */}
            {mode === 'password' && (
              <button
                type="button"
                onClick={handlePasswordUnlock}
                disabled={busy || isLockedOut || !password.trim()}
                style={{
                  width: '100%', padding: '10px 0', fontSize: 13, fontWeight: 600,
                  background: 'rgba(var(--rmpg-700-rgb),0.6)',
                  border: '1px solid rgba(var(--accent-silver-400-rgb),0.25)',
                  borderRadius: 2, color: 'var(--text-primary)',
                  cursor: busy || isLockedOut || !password.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: busy || isLockedOut || !password.trim() ? 0.5 : 1,
                }}
              >
                {busy
                  ? <><Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> Verifying…</>
                  : <><Lock style={{ width: 13, height: 13 }} /> Unlock</>}
              </button>
            )}

            {/* Footer links */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
              <button
                type="button"
                onClick={handleSwitchUser}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.04em' }}
              >
                <ChevronLeft style={{ width: 11, height: 11 }} /> Switch user
              </button>
              <button
                type="button"
                onClick={() => setEmergencyOpen(true)}
                style={{ background: 'none', border: 'none', color: 'rgba(var(--accent-silver-400-rgb),0.4)', fontSize: 10, cursor: 'pointer', letterSpacing: '0.04em', textDecoration: 'underline' }}
              >
                Emergency access
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center',
        fontSize: 10, color: 'rgba(var(--accent-silver-400-rgb),0.22)', letterSpacing: '0.07em', zIndex: 1,
      }}>
        Ctrl+Alt+Shift+F12 — Emergency Access · RMPG FlexOS Secured Platform
      </div>

      <DesktopEmergencyAccessModal
        isOpen={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        onEmergencyUnlock={() => { setEmergencyOpen(false); setAttempts(0); onUnlock(); }}
      />
    </div>
  );
}
