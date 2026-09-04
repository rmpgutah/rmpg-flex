import { useState } from 'react';
import { Shield, QrCode, Keyboard, Copy, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import BackupCodesDisplay from './BackupCodesDisplay';
import { importWithRetry } from '../../utils/importWithRetry';

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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Setup failed');
      }
      const data = await res.json();
      let qr = data.qrCodeDataUri as string | null;
      if (!qr && data.otpauthUrl) {
        // Worker returns otpauthUrl; render the QR locally (qrcode pkg).
        const QRCode = (await importWithRetry(() => import('qrcode'))).default;
        qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 220 });
      }
      setQrDataUri(qr || '');
      setManualKey(data.manualKey);
      setStep('scan');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
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
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Verification failed');
      }
      const data = await res.json();
      setBackupCodes(data.backupCodes);
      setStep('backup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setVerifyCode('');
    } finally {
      setLoading(false);
    }
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
            className={`flex-1 h-1 transition-colors duration-300 ${['intro', 'scan', 'verify', 'backup'].indexOf(step) >= i ? 'bg-fg-muted' : 'bg-[color:var(--border-subtle)]'}`}
          />
        ))}
      </div>

      {/* Step: Intro */}
      {step === 'intro' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 panel-inset bg-black/60">
              <Shield className="w-5 h-5 text-accent-silver-400" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-300">
                Enable Two-Factor Authentication
              </h3>
              <p className="text-[10px] mt-0.5 text-fg-muted">
                Add an extra layer of security to your account
              </p>
            </div>
          </div>

          <div className="space-y-2 text-[10px] text-fg-muted">
            <p>You will need an authenticator app such as:</p>
            <ul className="space-y-1 pl-4">
              <li className="flex items-center gap-2">
                <span className="led-dot led-green" style={{ width: 4, height: 4 }} />
                Google Authenticator
              </li>
              <li className="flex items-center gap-2">
                <span className="led-dot led-gray" style={{ width: 4, height: 4 }} />
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
              <button type="button" onClick={onCancel} className="toolbar-btn flex-1 h-8 text-[10px] uppercase tracking-wider">
                Cancel
              </button>
            )}
            <button type="button"
              onClick={startSetup}
              disabled={loading}
              className="toolbar-btn toolbar-btn-primary flex-1 h-8 text-rmpg-100 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
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
          <p className="text-[10px] text-fg-muted">
            Scan this QR code with your authenticator app:
          </p>

          {/* QR code */}
          <div className="flex justify-center">
            <div className="p-3 bg-white" style={{ borderRadius: 2 }}>
              {qrDataUri && <img src={qrDataUri} alt="2FA QR Code" width={180} height={180} />}
            </div>
          </div>

          {/* Manual key toggle */}
          <button type="button"
            onClick={() => setShowManual(!showManual)}
            className="text-[10px] flex items-center gap-1 mx-auto text-fg-muted"
          >
            <Keyboard className="w-3 h-3" />
            {showManual ? 'Hide manual key' : "Can't scan? Enter key manually"}
          </button>

          {showManual && (
            <div
              className="flex items-center gap-2 p-2 font-mono text-xs"
              style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-default)' }}
            >
              <span className="flex-1 tracking-widest text-center text-rmpg-300">
                {manualKey}
              </span>
              <button type="button" onClick={copyManualKey} className="toolbar-btn p-1">
                {keyCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          <button type="button"
            onClick={() => setStep('verify')}
            className="toolbar-btn toolbar-btn-primary w-full h-8 text-rmpg-100 text-[10px] font-bold uppercase tracking-wider"
          >
            I've Scanned the Code
          </button>
        </div>
      )}

      {/* Step: Verify */}
      {step === 'verify' && (
        <div className="space-y-4">
          <p className="text-[10px] text-fg-muted">
            Enter the 6-digit code from your authenticator app to confirm setup:
          </p>

          <input id="ff-twofactorsetupwizard-0"
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
            <div className="flex items-center gap-2 text-[10px] text-red-500">
              <AlertTriangle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button"
              onClick={() => { setStep('scan'); setError(''); }}
              className="toolbar-btn flex-1 h-8 text-[10px] uppercase tracking-wider"
            >
              Back
            </button>
            <button type="button"
              onClick={confirmSetup}
              disabled={verifyCode.length !== 6 || loading}
              className="toolbar-btn toolbar-btn-primary flex-1 h-8 text-rmpg-100 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 flex items-center justify-center gap-1.5"
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
            <span className="text-xs font-bold uppercase tracking-wider text-green-500">
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
            <div className="p-3 panel-inset bg-green-500/10">
              <Shield className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-300">
            Setup Complete
          </h3>
          <p className="text-[10px] text-fg-muted">
            Your account is now protected with two-factor authentication.
          </p>
        </div>
      )}

      {/* Error display (for intro/scan steps) */}
      {error && step !== 'verify' && (
        <div className="flex items-center gap-2 text-[10px] text-red-500">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}
