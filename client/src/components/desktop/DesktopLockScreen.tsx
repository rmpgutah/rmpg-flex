import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Lock, Eye, EyeOff, Shield, Loader2 } from 'lucide-react';
import { useClock } from '../../hooks/useClock';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../hooks/useApi';

const AGENCY_NAME = 'Rocky Mountain Protective Group';
const AGENCY_SHORT = 'RMPG';

// Auto-lock idle threshold in seconds. Kiosk default: 5 min. Normal: 15 min.
function getAutoLockSeconds(): number {
  try {
    const stored = localStorage.getItem('rmpg_desktop_autolock_secs');
    if (stored) return Math.max(60, parseInt(stored, 10));
  } catch { /* ignore */ }
  // Check if running in kiosk shell — shorter timeout when we ARE the OS shell
  return (localStorage.getItem('rmpg_kiosk_shell_enabled') === '1') ? 300 : 900;
}

export interface DesktopLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
}

type UnlockMode = 'password' | 'pin';

export default function DesktopLockScreen({ isLocked, onUnlock }: DesktopLockScreenProps) {
  const { time, date } = useClock();
  const { user, login } = useAuth();
  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const username = user?.username ?? '';
  const displayName = user ? `${user.first_name} ${user.last_name}` : 'Officer';
  const badge = user?.badge_number ? `Badge ${user.badge_number}` : user?.role ?? '';
  const initials = user ? `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase() : '?';

  // Focus input when locked
  useEffect(() => {
    if (isLocked) {
      setPassword('');
      setPin('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isLocked]);

  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil;
  const lockoutSecsLeft = lockoutUntil ? Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000)) : 0;

  // Clear lockout when timer expires
  useEffect(() => {
    if (!lockoutUntil) return;
    const id = setInterval(() => {
      if (Date.now() >= lockoutUntil) {
        setLockoutUntil(null);
        setAttempts(0);
        setError('');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const handleFailedAttempt = useCallback(() => {
    const next = attempts + 1;
    setAttempts(next);
    if (next >= 5) {
      // Progressive lockout: 30s, 60s, 120s
      const lockMs = Math.min(30_000 * Math.pow(2, next - 5), 120_000);
      setLockoutUntil(Date.now() + lockMs);
      setError(`Too many attempts. Locked for ${lockMs / 1000}s.`);
    } else {
      setError(`Incorrect ${mode === 'password' ? 'password' : 'PIN'}. ${5 - next} attempt${5 - next !== 1 ? 's' : ''} remaining.`);
    }
    setPassword('');
    setPin('');
    inputRef.current?.focus();
  }, [attempts, mode]);

  const handlePasswordUnlock = useCallback(async () => {
    if (!password.trim() || isLockedOut) return;
    setBusy(true);
    setError('');
    try {
      const result = await login(username, password);
      if (result.success && !result.requires2FA) {
        setAttempts(0);
        onUnlock();
      } else {
        handleFailedAttempt();
      }
    } catch {
      handleFailedAttempt();
    } finally {
      setBusy(false);
    }
  }, [password, username, login, onUnlock, handleFailedAttempt, isLockedOut]);

  const handlePinUnlock = useCallback(async () => {
    if (pin.length < 4 || isLockedOut) return;
    setBusy(true);
    setError('');
    try {
      // Try Tauri offline PIN first (works with no network)
      const el = (window as any).electron;
      if (el?.isElectron) {
        const result = await (window as any).__TAURI__?.core?.invoke?.('enter_pin', { pin });
        if (result?.ok) {
          setAttempts(0);
          onUnlock();
          return;
        }
      }
      // Fallback: validate against server
      const res = await apiFetch<{ ok: boolean }>('/auth/verify-pin', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });
      if (res?.ok) {
        setAttempts(0);
        onUnlock();
      } else {
        handleFailedAttempt();
      }
    } catch {
      handleFailedAttempt();
    } finally {
      setBusy(false);
    }
  }, [pin, onUnlock, handleFailedAttempt, isLockedOut]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'password') handlePasswordUnlock();
      else if (pin.length >= 4) handlePinUnlock();
    }
  }, [mode, pin, handlePasswordUnlock, handlePinUnlock]);

  if (!isLocked) return null;

  return (
    <div
      role="dialog"
      aria-label="Screen locked"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10, 20, 40, 0.97)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'inherit',
      }}
    >
      {/* Agency header */}
      <div style={{ position: 'absolute', top: 24, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Shield className="w-5 h-5" style={{ color: 'var(--accent-silver-400, #c3ccd6)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.12em', color: 'var(--accent-silver-300, #d4dde6)', textTransform: 'uppercase' }}>
            {AGENCY_SHORT} — {AGENCY_NAME}
          </span>
        </div>
      </div>

      {/* Clock */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 72, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--text-primary, #f0f4f9)', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </div>
        <div style={{ fontSize: 16, marginTop: 8, color: 'var(--text-muted, #8da0b3)', letterSpacing: '0.05em' }}>
          {date}
        </div>
      </div>

      {/* Lock card */}
      <div style={{
        width: 360,
        background: 'rgba(34, 64, 95, 0.6)',
        border: '1px solid rgba(195, 204, 214, 0.15)',
        padding: '32px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}>
        {/* Officer avatar */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.3)',
          border: '2px solid rgba(195, 204, 214, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--accent-silver-300, #d4dde6)',
          letterSpacing: '0.05em',
        }}>
          {initials}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #f0f4f9)' }}>{displayName}</div>
          {badge && <div style={{ fontSize: 11, color: 'var(--text-muted, #8da0b3)', marginTop: 2 }}>{badge}</div>}
        </div>

        {/* Mode switcher */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(195,204,214,0.2)', width: '100%' }}>
          {(['password', 'pin'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(''); setPassword(''); setPin(''); inputRef.current?.focus(); }}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: 11,
                fontWeight: mode === m ? 600 : 400,
                background: mode === m ? 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.25)' : 'transparent',
                color: mode === m ? 'var(--text-primary, #f0f4f9)' : 'var(--text-muted, #8da0b3)',
                border: 'none',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {m === 'password' ? 'Password' : 'PIN'}
            </button>
          ))}
        </div>

        {/* Input area */}
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
                width: '100%',
                padding: '10px 40px 10px 12px',
                fontSize: 14,
                background: 'rgba(10, 20, 40, 0.5)',
                border: error ? '1px solid var(--sev-critical, #ef4444)' : '1px solid rgba(195,204,214,0.2)',
                color: 'var(--text-primary, #f0f4f9)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(v => !v)}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted, #8da0b3)' }}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <div style={{ width: '100%' }}>
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
                width: '100%',
                padding: '10px 12px',
                fontSize: 24,
                letterSpacing: '0.5em',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
                background: 'rgba(10, 20, 40, 0.5)',
                border: error ? '1px solid var(--sev-critical, #ef4444)' : '1px solid rgba(195,204,214,0.2)',
                color: 'var(--text-primary, #f0f4f9)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{ width: '100%', fontSize: 11, color: 'var(--sev-critical, #ef4444)', textAlign: 'center' }}>
            {isLockedOut ? `Locked out — ${lockoutSecsLeft}s remaining` : error}
          </div>
        )}

        {/* Unlock button */}
        <button
          type="button"
          onClick={mode === 'password' ? handlePasswordUnlock : handlePinUnlock}
          disabled={busy || isLockedOut || (mode === 'password' ? !password : pin.length < 4)}
          style={{
            width: '100%',
            padding: '10px 0',
            fontSize: 13,
            fontWeight: 600,
            background: 'rgba(var(--rmpg-600-rgb, 45 90 135), 0.7)',
            border: '1px solid rgba(195,204,214,0.25)',
            color: 'var(--text-primary, #f0f4f9)',
            cursor: busy || isLockedOut ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: busy || isLockedOut ? 0.6 : 1,
          }}
        >
          {busy ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
          ) : (
            <><Lock className="w-4 h-4" /> Unlock</>
          )}
        </button>
      </div>

      {/* Lock icon bottom */}
      <div style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center', color: 'rgba(195,204,214,0.2)', fontSize: 11 }}>
        RMPG Flex — Secured Workstation
      </div>
    </div>
  );
}
