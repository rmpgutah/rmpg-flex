import { useState } from 'react';
import { X, Lock, Eye, EyeOff, AlertTriangle } from 'lucide-react';

// Configures encryption for the next save. Output of this dialog is consumed
// by the save flow in PdfEditorPage — server-side qpdf does the work.
//
// Permission semantics (PDF spec §7.6.3.2):
//  - userPassword empty + permission flags = "view-only / no-copy" PDFs
//  - userPassword set = open-prompt password
//  - ownerPassword auto-generated unless caller specifies one (controls
//    the ability to remove restrictions later)

export interface EncryptionConfig {
  userPassword: string;
  ownerPassword: string;
  bitLength: 128 | 256;
  permissions: {
    print: 'full' | 'low' | 'none';
    modify: 'all' | 'annotate' | 'form' | 'assembly' | 'none';
    extract: boolean;
    accessibility: boolean;
    fillForms: boolean;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (cfg: EncryptionConfig) => void;
}

const DEFAULT_CONFIG: EncryptionConfig = {
  userPassword: '',
  ownerPassword: '',
  bitLength: 256,
  permissions: {
    print: 'full',
    modify: 'none',
    extract: false,
    accessibility: true,
    fillForms: false,
  },
};

const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1';
const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function EncryptionDialog({ open, onClose, onConfirm }: Props) {
  const [cfg, setCfg] = useState<EncryptionConfig>(DEFAULT_CONFIG);
  const [showUser, setShowUser] = useState(false);
  const [showOwner, setShowOwner] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222222] rounded-[2px] p-4 max-w-[640px] w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#d4a017]" /> Encrypt PDF
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-[10px] text-rmpg-500 mb-3 max-w-prose">
          Encryption is applied server-side via qpdf (AES). Set permission flags to restrict what viewers can do. Leave the user password empty to allow opening without a prompt while still enforcing the restrictions below.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div>
              <label className={labelCls}>User password (open password)</label>
              <div className="relative">
                <input type={showUser ? 'text' : 'password'} value={cfg.userPassword}
                  onChange={(e) => setCfg({ ...cfg, userPassword: e.target.value })}
                  placeholder="Empty = no prompt to open"
                  className={inputCls + ' pr-7'} />
                <button type="button" onClick={() => setShowUser((v) => !v)} className="absolute right-1.5 top-1.5 text-rmpg-400 hover:text-white" aria-label="Toggle visibility">
                  {showUser ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Owner password (controls removing restrictions)</label>
              <div className="relative">
                <input type={showOwner ? 'text' : 'password'} value={cfg.ownerPassword}
                  onChange={(e) => setCfg({ ...cfg, ownerPassword: e.target.value })}
                  placeholder="Auto-generated random if blank"
                  className={inputCls + ' pr-7'} />
                <button type="button" onClick={() => setShowOwner((v) => !v)} className="absolute right-1.5 top-1.5 text-rmpg-400 hover:text-white" aria-label="Toggle visibility">
                  {showOwner ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Encryption strength</label>
              <select value={cfg.bitLength} onChange={(e) => setCfg({ ...cfg, bitLength: parseInt(e.target.value, 10) as 128 | 256 })} className={inputCls}>
                <option value={256}>256-bit AES (PDF 2.0 — strongest, recommended)</option>
                <option value={128}>128-bit AES (PDF 1.7 — broader compatibility)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className={labelCls}>Printing</label>
              <select value={cfg.permissions.print} onChange={(e) => setCfg({ ...cfg, permissions: { ...cfg.permissions, print: e.target.value as any } })} className={inputCls}>
                <option value="full">Allow high-resolution printing</option>
                <option value="low">Allow low-resolution printing only</option>
                <option value="none">Disallow printing</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Modifications</label>
              <select value={cfg.permissions.modify} onChange={(e) => setCfg({ ...cfg, permissions: { ...cfg.permissions, modify: e.target.value as any } })} className={inputCls}>
                <option value="all">Allow all modifications</option>
                <option value="annotate">Allow annotation only</option>
                <option value="form">Allow form filling only</option>
                <option value="assembly">Allow page assembly only</option>
                <option value="none">Disallow modifications</option>
              </select>
            </div>
            <div className="space-y-1 pt-1">
              <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
                <input type="checkbox" checked={cfg.permissions.extract} onChange={(e) => setCfg({ ...cfg, permissions: { ...cfg.permissions, extract: e.target.checked } })} />
                Allow text/image copy and extraction
              </label>
              <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
                <input type="checkbox" checked={cfg.permissions.fillForms} onChange={(e) => setCfg({ ...cfg, permissions: { ...cfg.permissions, fillForms: e.target.checked } })} />
                Allow form field filling
              </label>
              <label className="inline-flex items-center gap-2 text-[10px] text-rmpg-300">
                <input type="checkbox" checked={cfg.permissions.accessibility} onChange={(e) => setCfg({ ...cfg, permissions: { ...cfg.permissions, accessibility: e.target.checked } })} />
                Allow accessibility tools (screen readers)
              </label>
            </div>
          </div>
        </div>

        {!cfg.userPassword && !cfg.ownerPassword && (
          <div className="mt-3 bg-yellow-900/20 border border-yellow-700/40 text-yellow-200 text-[10px] px-2 py-1.5 rounded-sm flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div>An owner password will be auto-generated. Save it from the success message — it's the only way to lift the restrictions later.</div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={() => { onConfirm(cfg); onClose(); }} className="btn-primary inline-flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" /> Apply on next save
          </button>
        </div>
      </div>
    </div>
  );
}
