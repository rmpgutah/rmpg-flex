import { useEffect, useState } from 'react';
import { X, Heading } from 'lucide-react';
import { HeaderFooterConfig } from '../types';

// Custom header/footer text editor. Six slots (header L/C/R + footer L/C/R)
// plus a shared font size. Supports the {n} / {total} tokens. Distinct from
// the simple "Page N of M" footer toggle.

interface Props {
  open: boolean;
  value: HeaderFooterConfig | null;
  onClose: () => void;
  onApply: (cfg: HeaderFooterConfig | null) => void;
}

const inputCls = 'w-full bg-surface-sunken border border-border-default text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';
const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5';

export default function HeaderFooterDialog({ open, value, onClose, onApply }: Props) {
  const [cfg, setCfg] = useState<HeaderFooterConfig>(
    value ?? { headerLeft: '', headerCenter: '', headerRight: '', footerLeft: '', footerCenter: '', footerRight: '', fontSize: 9 },
  );
  useEffect(() => {
    if (open) setCfg(value ?? { headerLeft: '', headerCenter: '', headerRight: '', footerLeft: '', footerCenter: '', footerRight: '', fontSize: 9 });
  }, [open, value]);

  if (!open) return null;
  const set = (k: keyof HeaderFooterConfig, v: string | number) => setCfg(c => ({ ...c, [k]: v }));
  const hasAny = !!(cfg.headerLeft || cfg.headerCenter || cfg.headerRight || cfg.footerLeft || cfg.footerCenter || cfg.footerRight);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-base border border-border-default rounded-[2px] w-[460px] max-w-full p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Heading className="w-4 h-4 text-[#d4a017]" />
          <div className="text-sm text-rmpg-100 font-semibold">Header & Footer</div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-rmpg-400 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="text-[9px] text-[#d4a017] uppercase tracking-wider mb-1 font-semibold">Header</div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div><label htmlFor="ff-hf-hl" className={labelCls}>Left</label><input id="ff-hf-hl" value={cfg.headerLeft ?? ''} onChange={e => set('headerLeft', e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="ff-hf-hc" className={labelCls}>Center</label><input id="ff-hf-hc" value={cfg.headerCenter ?? ''} onChange={e => set('headerCenter', e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="ff-hf-hr" className={labelCls}>Right</label><input id="ff-hf-hr" value={cfg.headerRight ?? ''} onChange={e => set('headerRight', e.target.value)} className={inputCls} /></div>
        </div>

        <div className="text-[9px] text-[#d4a017] uppercase tracking-wider mb-1 font-semibold">Footer</div>
        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <div><label htmlFor="ff-hf-fl" className={labelCls}>Left</label><input id="ff-hf-fl" value={cfg.footerLeft ?? ''} onChange={e => set('footerLeft', e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="ff-hf-fc" className={labelCls}>Center</label><input id="ff-hf-fc" value={cfg.footerCenter ?? ''} onChange={e => set('footerCenter', e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="ff-hf-fr" className={labelCls}>Right</label><input id="ff-hf-fr" value={cfg.footerRight ?? ''} onChange={e => set('footerRight', e.target.value)} className={inputCls} /></div>
        </div>

        <div className="flex items-end gap-2 mb-3">
          <div className="w-24">
            <label htmlFor="ff-hf-fs" className={labelCls}>Font size</label>
            <input id="ff-hf-fs" type="number" min={6} max={24} value={cfg.fontSize} onChange={e => set('fontSize', parseInt(e.target.value, 10) || 9)} className={inputCls} />
          </div>
          <div className="text-[9px] text-rmpg-600 pb-1">Tokens: {'{n}'} = page number, {'{total}'} = page count.</div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => { onApply(null); onClose(); }} className="btn-secondary text-[11px]">Remove</button>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="btn-secondary text-[11px]">Cancel</button>
          <button type="button" onClick={() => { onApply(hasAny ? cfg : null); onClose(); }} className="btn-primary text-[11px]">Apply to all pages</button>
        </div>
      </div>
    </div>
  );
}
