// ============================================================
// RMPG Flex — 2FA Setup Prompt Modal
// Prompts the user to set up two-factor authentication when
// their role requires it. Can be deferred with "Set Up Later"
// so officers can sign in on new devices (Windows, mobile)
// without being blocked. A reminder banner persists in Layout.
// ============================================================

import React, { useState } from 'react';
import { ShieldCheck, AlertCircle, Check, Copy, Clock } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import TotpCodeInput from './TotpCodeInput';

/** Session key — tracks whether user dismissed the 2FA prompt this session */
const DEFER_KEY = 'rmpg_2fa_deferred';

export default function Force2FASetupModal() {
  const { user, refreshUser } = useAuth();

  const [step, setStep] = useState<'intro' | 'qr' | 'backups'>('intro');
  const [deferred, setDeferred] = useState(() => sessionStorage.getItem(DEFER_KEY) === '1');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedBackups, setCopiedBackups] = useState(false);

  const handleStartSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await apiFetch<any>('/auth/totp/setup', { method: 'POST' });
      setQrDataUrl(data.qrCodeDataUrl);
      setBackupCodes(data.backupCodes || []);
      setStep('qr');
    } catch (err: any) {
      setError(err?.message || 'Failed to start 2FA setup');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (code: string) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch<any>('/auth/totp/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setStep('backups');
    } catch (err: any) {
      setError(err?.message || 'Invalid verification code');
      setSetupCode('');
    } finally {
      setBusy(false);
    }
  };

  const handleDone = async () => {
    // Refresh user to clear requires_2fa_setup flag
    await refreshUser();
  };

  const handleCopyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBackups(true);
      setTimeout(() => setCopiedBackups(false), 2000);
    }).catch(() => {});
  };

  const handleDefer = () => {
    sessionStorage.setItem(DEFER_KEY, '1');
    setDeferred(true);
  };

  if (!user?.requires_2fa_setup || deferred) return null;

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
            <ShieldCheck style={{ width: 20, height: 20, color: '#1a5a9e' }} />
            <div className="text-lg font-bold text-white">Two-Factor Authentication Required</div>
          </div>
          <div className="text-xs text-rmpg-400 max-w-sm mx-auto">
            Your role requires two-factor authentication via Google Authenticator (or compatible app).
            You must enable 2FA before you can use the system.
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 px-3 py-2 flex items-center gap-2">
            <AlertCircle style={{ width: 12, height: 12, flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* ── Intro: Explain + Start ───────────────────── */}
        {step === 'intro' && (
          <div className="space-y-4">
            <div
              className="p-3 text-[10px] space-y-2"
              style={{ background: '#0d1520', border: '1px solid #162236', color: '#8a9aaa' }}
            >
              <div className="font-bold text-[9px] uppercase tracking-wider mb-2" style={{ color: '#e0e0e0' }}>
                What You'll Need
              </div>
              <div>1. Install <strong className="text-white">Google Authenticator</strong> on your phone (iOS or Android)</div>
              <div>2. Scan a QR code with the app</div>
              <div>3. Enter the 6-digit code from the app to verify</div>
              <div>4. Save your backup recovery codes</div>
            </div>

            <button type="button"
              onClick={handleStartSetup}
              disabled={busy}
              className="btn-primary w-full justify-center"
            >
              <ShieldCheck style={{ width: 14, height: 14 }} />
              {busy ? 'Setting up...' : 'Begin 2FA Setup'}
            </button>

            <button type="button"
              onClick={handleDefer}
              className="w-full flex items-center justify-center gap-2 py-2 text-[10px] uppercase tracking-wider font-bold transition-colors"
              style={{ color: '#5a6e80', background: 'transparent', border: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#8a9aaa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#5a6e80')}
            >
              <Clock style={{ width: 12, height: 12 }} />
              Set Up Later
            </button>
          </div>
        )}

        {/* ── QR Code + Verify ─────────────────────────── */}
        {step === 'qr' && (
          <div className="space-y-4">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8a9aaa' }}>
              Step 1: Scan QR Code
            </div>
            <p className="text-[10px]" style={{ color: '#5a6e80' }}>
              Open Google Authenticator and scan this QR code to add your account.
            </p>

            <div className="flex justify-center py-2" style={{ background: '#fff', borderRadius: 2 }}>
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="TOTP QR Code"
                  style={{ width: 200, height: 200, imageRendering: 'pixelated' }}
                  draggable={false}
                />
              )}
            </div>

            <div className="text-[10px] font-bold uppercase tracking-wider mt-3" style={{ color: '#8a9aaa' }}>
              Step 2: Enter Verification Code
            </div>
            <p className="text-[10px]" style={{ color: '#5a6e80' }}>
              Enter the 6-digit code shown in Google Authenticator.
            </p>

            <TotpCodeInput
              value={setupCode}
              onChange={setSetupCode}
              onComplete={handleVerify}
              disabled={busy}
              error={!!error}
            />

            {busy && (
              <div className="flex items-center justify-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-[10px]" style={{ color: '#8a9aaa' }}>Verifying...</span>
              </div>
            )}
          </div>
        )}

        {/* ── Backup Codes ─────────────────────────────── */}
        {step === 'backups' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 py-2">
              <Check style={{ width: 24, height: 24, color: '#22c55e' }} />
              <span className="text-sm font-bold text-green-400">2FA Enabled Successfully</span>
            </div>

            <div
              className="p-3"
              style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid #991b1b' }}
            >
              <div className="flex items-center gap-1 mb-2">
                <AlertCircle style={{ width: 12, height: 12, color: '#ef4444' }} />
                <span className="text-[9px] font-bold uppercase" style={{ color: '#ef4444' }}>
                  Save these recovery codes — they will NOT be shown again
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

            <p className="text-[9px] text-center" style={{ color: '#5a6e80' }}>
              If you lose your phone, use one of these one-time codes to log in.
              Each code can only be used once.
            </p>

            <div className="flex gap-2">
              <button type="button" onClick={handleCopyBackupCodes} className="btn-secondary flex-1 justify-center">
                {copiedBackups ? (
                  <><Check style={{ width: 12, height: 12 }} /> Copied!</>
                ) : (
                  <><Copy style={{ width: 12, height: 12 }} /> Copy Codes</>
                )}
              </button>
              <button type="button" onClick={handleDone} className="btn-primary flex-1 justify-center">
                <Check style={{ width: 12, height: 12 }} /> I've Saved My Codes
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
