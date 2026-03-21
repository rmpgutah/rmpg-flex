// ============================================================
// RMPG Flex — Force Password Change Modal
// Blocks the entire UI until the user changes their password.
// Triggered when must_change_password flag is set on user record.
// Cannot be closed or dismissed.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { Shield, Eye, EyeOff, Check, AlertCircle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

interface PasswordRule {
  label: string;
  met: boolean;
}

export default function ForcePasswordChangeModal() {
  const { user, logout, refreshUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [policyRules, setPolicyRules] = useState<string[]>([]);
  const [minLength, setMinLength] = useState(12);
  const [requireSpecial, setRequireSpecial] = useState(true);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up logout timer on unmount
  useEffect(() => {
    return () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };
  }, []);

  // Fetch password policy on mount
  useEffect(() => {
    apiFetch<any>('/auth/password-policy')
      .then(data => {
        setPolicyRules(Array.isArray(data?.policy) ? data.policy : []);
        if (data?.rules?.minLength) setMinLength(data.rules.minLength);
        if (data?.rules?.requireSpecial !== undefined) setRequireSpecial(data.rules.requireSpecial);
      })
      .catch(err => console.warn("[API] Load failed:", err));
  }, []);

  // Live policy validation — rules fetched dynamically from server
  const rules: PasswordRule[] = [
    { label: `At least ${minLength} characters`, met: newPassword.length >= minLength },
    { label: 'Contains uppercase letter', met: /[A-Z]/.test(newPassword) },
    { label: 'Contains lowercase letter', met: /[a-z]/.test(newPassword) },
    { label: 'Contains a number', met: /[0-9]/.test(newPassword) },
    ...(requireSpecial ? [{ label: 'Contains special character (!@#$%^&*…)', met: /[^A-Za-z0-9]/.test(newPassword) }] : []),
    { label: 'Passwords match', met: newPassword.length > 0 && newPassword === confirmPassword },
  ];

  const allRulesMet = rules.every(r => r.met);
  const canSubmit = currentPassword.length > 0 && allRulesMet && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      setSuccess(true);

      // Refresh user state so must_change_password is cleared and modal dismisses.
      // Brief delay so the user can see the success message.
      logoutTimerRef.current = setTimeout(async () => {
        logoutTimerRef.current = null;
        try {
          await refreshUser();
        } catch {
          // If refresh fails (session invalidated), fall back to logout
          logout();
        }
      }, 1500);
    } catch (err: any) {
      setError(err?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  if (!user?.must_change_password) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.90)', zIndex: 99999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div
        className="w-full max-w-md mx-4 p-6 space-y-5"
        style={{
          background: '#141e2b',
          border: '1px solid #1e3048',
          borderTop: '3px solid #1a5a9e',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Shield style={{ width: 20, height: 20, color: '#1a5a9e' }} />
            <div className="text-lg font-bold text-white">Password Change Required</div>
          </div>
          <div className="text-xs text-gray-400 max-w-sm mx-auto">
            Your administrator has required you to change your password before continuing.
            This is a one-time requirement for account security.
          </div>
        </div>

        {success ? (
          <div className="text-center space-y-3 py-4">
            <Check style={{ width: 32, height: 32, color: '#22c55e', margin: '0 auto' }} />
            <div className="text-sm text-green-400 font-bold">Password changed successfully!</div>
            <div className="text-xs text-gray-400">Redirecting to login...</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Password */}
            <div>
              <label className="field-label">Current Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type={showCurrentPw ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="input-dark w-full pr-8"
                  placeholder="Enter your current password"
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white"
                >
                  {showCurrentPw
                    ? <EyeOff style={{ width: 14, height: 14 }} />
                    : <Eye style={{ width: 14, height: 14 }} />
                  }
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="field-label">New Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="input-dark w-full pr-8"
                  placeholder="Enter a new password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white"
                >
                  {showNewPw
                    ? <EyeOff style={{ width: 14, height: 14 }} />
                    : <Eye style={{ width: 14, height: 14 }} />
                  }
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="field-label">Confirm New Password <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="input-dark w-full"
                placeholder="Re-enter new password"
                autoComplete="new-password"
              />
            </div>

            {/* Password Strength Indicator */}
            {newPassword.length > 0 && (() => {
              let score = 0;
              if (newPassword.length >= 8) score++;
              if (newPassword.length >= 12) score++;
              if (/[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword)) score++;
              if (/[0-9]/.test(newPassword)) score++;
              if (/[^A-Za-z0-9]/.test(newPassword)) score++;
              const level = score <= 2 ? 'Weak' : score <= 3 ? 'Medium' : 'Strong';
              const color = score <= 2 ? '#ef4444' : score <= 3 ? '#f59e0b' : '#22c55e';
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px]" style={{ color }}>Strength: {level}</span>
                  </div>
                  <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(score / 5) * 100}%`, background: color }} />
                  </div>
                </div>
              );
            })()}

            {/* Password Policy Rules */}
            <div className="space-y-1 px-1">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  {rule.met ? (
                    <Check style={{ width: 10, height: 10, color: '#22c55e', flexShrink: 0 }} />
                  ) : (
                    <AlertCircle style={{ width: 10, height: 10, color: '#5a6e80', flexShrink: 0 }} />
                  )}
                  <span className={rule.met ? 'text-green-400' : 'text-gray-500'}>
                    {rule.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Error Message */}
            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 px-3 py-2">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary w-full justify-center"
            >
              {saving ? 'Changing Password...' : 'Change Password & Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
