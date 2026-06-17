import { useState } from 'react';
import { X, EyeOff } from 'lucide-react';

// Search-and-redact by pattern. The user picks one or more built-in pattern
// classes (SSN / phone / email) or supplies a custom regex; the editor scans
// the document text layer and drops a redaction box over every match.

export interface RedactPattern { id: string; label: string; regex: RegExp; }

export const BUILTIN_PATTERNS: RedactPattern[] = [
  { id: 'ssn', label: 'Social Security Number', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { id: 'phone', label: 'Phone number', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { id: 'email', label: 'Email address', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: 'creditcard', label: 'Credit-card number', regex: /\b(?:\d[ -]?){13,16}\b/ },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (regex: RegExp) => void;
  scanning: boolean;
}

const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function RedactPatternDialog({ open, onClose, onRun, scanning }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set(['ssn', 'phone', 'email']));
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const run = () => {
    setError(null);
    const sources: string[] = [];
    for (const p of BUILTIN_PATTERNS) if (picked.has(p.id)) sources.push(p.regex.source);
    if (custom.trim()) {
      try { new RegExp(custom); sources.push(custom.trim()); }
      catch { setError('Custom pattern is not a valid regular expression.'); return; }
    }
    if (sources.length === 0) { setError('Select at least one pattern (or enter a custom one).'); return; }
    const combined = new RegExp(sources.map(s => `(?:${s})`).join('|'));
    onRun(combined);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-[#222] rounded-[2px] w-[420px] max-w-full p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <EyeOff className="w-4 h-4 text-[#d4a017]" />
          <div className="text-sm text-rmpg-100 font-semibold">Search & Redact</div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-rmpg-400 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="text-[10px] text-rmpg-500 mb-2">
          Scans selectable text and drops an opaque redaction box over every match across all pages.
          Review the boxes, then Save to bake them into the output.
        </div>

        <div className="space-y-1.5 mb-3">
          {BUILTIN_PATTERNS.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-[11px] text-rmpg-200">
              <input id={`ff-redact-${p.id}`} type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              {p.label} <span className="text-rmpg-600 font-mono text-[9px]">{p.regex.source.slice(0, 28)}…</span>
            </label>
          ))}
        </div>

        <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">Custom regex (optional)</label>
        <input id="ff-redact-custom" value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. \bCASE-\d{6}\b" className={inputCls} />

        {error && <div className="text-[10px] text-red-300 mt-2">{error}</div>}

        <div className="flex items-center gap-2 pt-3">
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="btn-secondary text-[11px]">Cancel</button>
          <button type="button" onClick={run} disabled={scanning} className="btn-primary text-[11px] disabled:opacity-50">
            {scanning ? 'Scanning…' : 'Find & redact'}
          </button>
        </div>
      </div>
    </div>
  );
}
