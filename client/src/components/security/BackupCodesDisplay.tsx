import { useState } from 'react';
import { Download, Copy, Check, AlertTriangle } from 'lucide-react';

interface Props {
  codes: string[];
  onAcknowledge: () => void;
}

export default function BackupCodesDisplay({ codes, onAcknowledge }: Props) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = codes.join('\n');
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const content = [
      'RMPG Flex — Two-Factor Authentication Backup Codes',
      '══════════════════════════════════════════════════',
      '',
      'Each code can only be used ONCE.',
      'Store these codes in a secure location.',
      '',
      ...codes.map((code, i) => `  ${(i + 1).toString().padStart(2, ' ')}. ${code}`),
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rmpg-flex-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div
        className="flex items-start gap-2 p-3"
        style={{ background: 'rgba(212, 160, 23, 0.12)', border: '1px solid rgba(212, 160, 23, 0.4)' }}
      >
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#d4a017' }} />
        <div className="text-[10px] leading-relaxed" style={{ color: '#e8b820' }}>
          <strong>Save these codes now.</strong> They will not be shown again. Each code can only be used once
          to log in if you lose access to your authenticator app.
        </div>
      </div>

      {/* Codes grid */}
      <div
        className="grid grid-cols-2 gap-1.5 p-3 font-mono"
        style={{ background: '#050505', border: '1px solid #1e3048' }}
      >
        {codes.map((code, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-2 py-1"
            style={{ background: '#0a0a0a' }}
          >
            <span className="text-[9px] w-4 text-right" style={{ color: '#6b7280' }}>
              {i + 1}.
            </span>
            <span className="text-body-sm tracking-wider" style={{ color: '#e5e7eb' }}>
              {code}
            </span>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button type="button"
          onClick={handleCopy}
          className="toolbar-btn flex-1 flex items-center justify-center gap-1.5 h-8 text-[10px] uppercase tracking-wider"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy All'}
        </button>
        <button type="button"
          onClick={handleDownload}
          className="toolbar-btn flex-1 flex items-center justify-center gap-1.5 h-8 text-[10px] uppercase tracking-wider"
        >
          <Download className="w-3 h-3" />
          Download .txt
        </button>
      </div>

      {/* Acknowledge checkbox + button */}
      <div className="pt-2" style={{ borderTop: '1px solid #1e3048' }}>
        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="accent-brand-500"
          />
          <span className="text-[10px]" style={{ color: '#888888' }}>
            I have saved my backup codes in a secure location
          </span>
        </label>

        <button type="button"
          onClick={onAcknowledge}
          disabled={!acknowledged}
          className="toolbar-btn toolbar-btn-primary w-full h-9 text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
