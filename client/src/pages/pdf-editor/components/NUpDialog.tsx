import { useState } from 'react';
import { Grid2x2, X } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface Props {
  open: boolean;
  busy?: boolean;
  pageCount: number;
  onClose: () => void;
  onExport: (up: 2 | 4, size: 'Letter' | 'A4') => void;
}

/** N-up imposition export — lay 2 or 4 source pages onto each sheet. The
 *  actual layout runs in the parent via buildNUpPdf. */
export default function NUpDialog({ open, busy, pageCount, onClose, onExport }: Props) {
  const [up, setUp] = useState<2 | 4>(2);
  const [size, setSize] = useState<'Letter' | 'A4'>('Letter');
  if (!open) return null;
  const sheets = Math.ceil(pageCount / up);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[360px] p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[#d4a017] font-semibold inline-flex items-center gap-1.5">
            <Grid2x2 className="w-3.5 h-3.5" /> N-up export
          </div>
          <IconButton onClick={onClose} aria-label="Close" title="Close" className="text-rmpg-400 hover:text-rmpg-100 p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="text-[10px] text-rmpg-500 mb-3">Combine multiple source pages onto each printed sheet. Annotations are baked in first.</div>

        <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1">Pages per sheet</label>
        <div className="flex gap-1 mb-3">
          {([2, 4] as const).map(n => (
            <button key={n} type="button" onClick={() => setUp(n)}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded-sm border ${up === n ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400 hover:text-rmpg-100'}`}>
              {n}-up
            </button>
          ))}
        </div>

        <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1">Sheet size</label>
        <div className="flex gap-1 mb-3">
          {(['Letter', 'A4'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSize(s)}
              className={`flex-1 px-2 py-1.5 text-[11px] rounded-sm border ${size === s ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400 hover:text-rmpg-100'}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-rmpg-400 mb-3">{pageCount} page{pageCount === 1 ? '' : 's'} → <span className="text-[#d4a017] font-mono">{sheets}</span> sheet{sheets === 1 ? '' : 's'} ({size}{up === 2 ? ' landscape' : ''}).</div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-[11px]">Cancel</button>
          <button type="button" disabled={busy} onClick={() => onExport(up, size)} className="btn-primary text-[11px] disabled:opacity-50">{busy ? 'Building…' : 'Export N-up'}</button>
        </div>
      </div>
    </div>
  );
}
