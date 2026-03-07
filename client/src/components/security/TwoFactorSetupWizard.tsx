import { useState } from 'react';
import { Shield, QrCode, Keyboard, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import BackupCodesDisplay from './BackupCodesDisplay';

type WizardStep = 'intro' | 'scan' | 'verify' | 'backup' | 'complete';

interface Props {
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function TwoFactorSetupWizard({ onComplete, onCancel }: Props) {
  const { token } = useAuth();
  const [step, setStep] = useState<WizardStep>('intro');
  const [qrDataUri, setQrDataUri] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);

  const startSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      setQrDataUri(data.qrCodeDataUri);
      setManualKey(data.manualKey);
      setStep('scan');
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const confirmSetup = async () => {
    if (verifyCode.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/2fa/setup/verify', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setBackupCodes(data.backupCodes);
      setStep('backup');
    } catch (err: any) {
      setError(err.message);
      setVerifyCode('');
    }
    setLoading(false);
  };

  const copyManualKey = async () => {
    try {
      await navigator.clipboard.writeText(manualKey);
    } catch {
      const el = document.createElement('textarea');
      el.value = manualKey;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex gap-1">
        {(['intro', 'scan', 'verify', 'backup'] as WizardStep[]).map((s, i) => (
          <div
            key={s}
            className="flex-1 h-1 transition-colors duration-300"
            style={{
              background: ['intro', 'scan', 'verify', 'backup'].indexOf(step) >= i
                ? '#1a5a9e'
                : '#1e3048',
            }}
          />
        ))}
      </div>

      {/* Step: Intro */}
      {step === 'intro' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 panel-inset" style={{ background: 'rgba(26,90,158,0.1)' }}>
              <Shield className="w-5 h-5" style={{ color: '#1a5a9e' }} />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#e5e7eb' }}>
                Enable Two-Factor Authentication
              </h3>
              <p className="text-[10px] mt-0.5" style={{ color: '#6b7280' }}>
                Add an extra layer of security to your account
              </p>
            </div>
          </div>

          <div className="space-y-2 text-[10px]" style={{ color: '#8a9aaa' }}>
            <p>You will need an authenticator app such as:</p>
            <ul className="space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="led-dot led-green" style={{ width: 4, height: 4 }} />
                Google Authenticator
              </li>
              <li className="flex items-center gap-2">
                <span className="led-dot led-blue" style={{ width: 4, height: 4 }} />
                Microsoft Authenticator
              </li>
              <li className="flex items-center gap-2">
                <span className="led-dot led-purple" style={{ width: 4, height: 4 }} />
                Authy
              </li>
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            {onCancel && (
              <button onClick={onCancel} className="toolbar-btn flex-1 h-8 text-[10px] uppercase tracking-wider">
                Cancel
              </button>
            )}
            <button
              onClick={startSetup}
              disabled={loading}
              className="toolbar-btn toolbar-btn-primary flex-1 h-8 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <QrCode className="w-3 h-3" />}
              Begin Setup
            </button>
          </div>
        </div>
      )}

      {/* Step: Scan QR */}
      {step === 'scan' && (
        <div className="space-y-4">
          <p className="text-[10px]" style={{ color: '#8a9aaa' }}>
            Scan this QR code with your authenticator app:
          </p>

          {/* QR code */}
          <div className="flex justify-center">
            <div className="p-3" style={{ background: '#ffffff', borderRadius: 4 }}>
              {qrDataUri && <img src={qrDataUri} alt="2FA QR Code" width={180} height={180} />}
            </div>
          </div>

          {/* Manual key toggle */}
          <button
            onClick={() => setShowManual(!showManual)}
            className="text-[10px] flex items-center gap-1 mx-auto"
            style={{ color: '#4a90c4' }}
          >
            <Keyboard className="w-3 h-3" />
            {showManual ? 'Hide manual key' : "Can't scan? Enter key manually"}
          </button>

          {showManual && (
            <div
              className="flex items-center gap-2 p-2 font-mono text-xs"
              style={{ background: '#0d1520', border: '1px solid #1e3048' }}
            >
              <span className="flex-1 tracking-widest text-center" style={{ color: '#e5e7eb' }}>
                {manualKey}
              </span>
              <button onClick={copyManualKey} className="toolbar-btn p-1">
                {keyCopied ? <Check className="w-3 h-3" style={{ color: '#22c55e' }} /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          <button
            onClick={() => setStep('verify')}
            className="toolbar-btn toolbar-btn-primary w-full h-8 text-white text-[10px] font-bold uppercase tracking-wider"
          >
            I've Scanned the Code
          </button>
        </div>
      )}

      {/* Step: Verify */}
      {step === 'verify' && (
        <div className="space-y-4">
          <p className="text-[10px]" style={{ color: '#8a9aaa' }}>
            Enter the 6-digit code from your authenticator app to confirm setup:
          </p>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={verifyCode}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
              setVerifyCode(v);
            }}
            placeholder="000000"
            className="input-dark text-center text-2xl font-mono tracking-[0.5em] h-12"
            autoFocus
          />

          {error && (
            <div className="flex items-center gap-2 text-[10px]" style={{ color: '#ef4444' }}>
              <AlertTriangle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setStep('scan'); setError(''); }}
              className="toolbar-btn flex-1 h-8 text-[10px] uppercase tracking-wider"
            >
              Back
            </button>
            <button
              onClick={confirmSetup}
              disabled={verifyCode.length !== 6 || loading}
              className="toolbar-btn toolbar-btn-primary flex-1 h-8 text-white text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Verify & Enable'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Backup Codes */}
      {step === 'backup' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="led-dot led-green" />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>
              2FA Enabled Successfully
            </span>
          </div>

          <BackupCodesDisplay
            codes={backupCodes}
            onAcknowledge={() => {
              setStep('complete');
              onComplete?.();
            }}
          />
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && (
        <div className="text-center py-4 space-y-3">
          <div className="flex justify-center">
            <div className="p-3 panel-inset" style={{ background: 'rgba(34,197,94,0.1)' }}>
              <Shield className="w-8 h-8" style={{ color: '#22c55e' }} />
            </div>
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#e5e7eb' }}>
            Setup Complete
          </h3>
          <p className="text-[10px]" style={{ color: '#6b7280' }}>
            Your account is now protected with two-factor authentication.
          </p>
        </div>
      )}

      {/* Error display (for intro/scan steps) */}
      {error && step !== 'verify' && (
        <div className="flex items-center gap-2 text-[10px]" style={{ color: '#ef4444' }}>
          <AlertTriangle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}
