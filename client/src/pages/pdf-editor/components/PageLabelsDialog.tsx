import { useEffect, useState } from 'react';
import { Hash, X, Plus, Trash2 } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { PageLabelRule } from '../types';
import { resolvePageLabel } from '../pageNumbering';

interface Props {
  open: boolean;
  pageCount: number;
  rules: PageLabelRule[];
  onClose: () => void;
  onApply: (rules: PageLabelRule[]) => void;
}

const STYLES: Array<{ value: PageLabelRule['style']; label: string }> = [
  { value: 'decimal', label: '1, 2, 3' },
  { value: 'roman', label: 'i, ii, iii' },
  { value: 'Roman', label: 'I, II, III' },
  { value: 'alpha', label: 'a, b, c' },
  { value: 'Alpha', label: 'A, B, C' },
];

const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

/** Configure custom page-label rules (prefix + numbering style per page range).
 *  Drives the {label} token in the page-number footer. */
export default function PageLabelsDialog({ open, pageCount, rules, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<PageLabelRule[]>(rules);
  useEffect(() => { if (open) setDraft(rules); }, [open, rules]);
  if (!open) return null;

  const update = (id: string, patch: Partial<PageLabelRule>) =>
    setDraft(d => d.map(r => r.id === id ? { ...r, ...patch } : r));
  const add = () => setDraft(d => [...d, {
    id: Math.random().toString(36).slice(2, 10),
    from: 1, to: Math.min(pageCount, 1), prefix: '', style: 'decimal', start: 1,
  }]);
  const remove = (id: string) => setDraft(d => d.filter(r => r.id !== id));

  // Live preview of the first few pages so the user sees the effect.
  const previewN = Math.min(pageCount, 8);
  const preview = Array.from({ length: previewN }, (_, i) => resolvePageLabel(draft, i + 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[460px] max-h-[86vh] overflow-y-auto p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[#d4a017] font-semibold inline-flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" /> Page labels
          </div>
          <IconButton onClick={onClose} aria-label="Close" title="Close" className="text-rmpg-400 hover:text-rmpg-100 p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="text-[10px] text-rmpg-500 mb-3">
          Label page ranges with a prefix + numbering style (e.g. "Roman i–iv for front matter, then 1, 2, 3…").
          Use the <span className="font-mono text-rmpg-300">{'{label}'}</span> token in the page-number footer to print these.
        </div>

        <div className="space-y-2 mb-3">
          {draft.length === 0 && <div className="text-[10px] text-rmpg-600 italic">No rules — pages print as plain 1, 2, 3…</div>}
          {draft.map(r => (
            <div key={r.id} className="border border-[#1a1a1a] rounded-sm p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex-1">
                  <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">From</label>
                  <input type="number" min={1} max={pageCount} value={r.from}
                    onChange={e => update(r.id, { from: Math.max(1, Math.min(pageCount, parseInt(e.target.value, 10) || 1)) })} className={inputCls} />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">To</label>
                  <input type="number" min={1} max={pageCount} value={r.to}
                    onChange={e => update(r.id, { to: Math.max(1, Math.min(pageCount, parseInt(e.target.value, 10) || 1)) })} className={inputCls} />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">Start #</label>
                  <input type="number" min={1} value={r.start}
                    onChange={e => update(r.id, { start: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={inputCls} />
                </div>
                <IconButton onClick={() => remove(r.id)} aria-label="Remove rule" title="Remove rule" className="self-end p-1 text-rmpg-400 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></IconButton>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex-1">
                  <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">Prefix</label>
                  <input value={r.prefix} onChange={e => update(r.id, { prefix: e.target.value })} placeholder="e.g. A-" className={inputCls} />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5">Style</label>
                  <select value={r.style} onChange={e => update(r.id, { style: e.target.value as PageLabelRule['style'] })} className={inputCls}>
                    {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-[10px] text-rmpg-300 border border-[#222] rounded-sm px-2 py-1 hover:text-rmpg-100 mb-3">
          <Plus className="w-3 h-3" /> Add rule
        </button>

        <div className="border border-[#1a1a1a] rounded-sm p-2 mb-3">
          <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">Preview (first {previewN})</div>
          <div className="flex flex-wrap gap-1">
            {preview.map((p, i) => (
              <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 bg-[#0a0a0a] border border-[#222] rounded-sm text-rmpg-200">{p}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-[11px]">Cancel</button>
          <button type="button" onClick={() => { onApply(draft); onClose(); }} className="btn-primary text-[11px]">Apply labels</button>
        </div>
      </div>
    </div>
  );
}
