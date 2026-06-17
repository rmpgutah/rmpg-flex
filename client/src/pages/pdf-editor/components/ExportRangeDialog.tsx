import { useEffect, useState } from 'react';
import { FileOutput, X } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface Props {
  open: boolean;
  pageCount: number;
  onClose: () => void;
  onExport: (from: number, to: number) => void;
}

/** Export an arbitrary page range (1-indexed, current visual order) to a new
 *  PDF. Pure UI — the actual extraction runs in the parent via
 *  extractPagesAsBytes. */
export default function ExportRangeDialog({ open, pageCount, onClose, onExport }: Props) {
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(pageCount);

  // Re-seed the bounds whenever the dialog opens or the doc page count changes.
  useEffect(() => {
    if (open) { setFrom(1); setTo(pageCount); }
  }, [open, pageCount]);

  if (!open) return null;

  const clampedFrom = Math.max(1, Math.min(from, pageCount));
  const clampedTo = Math.max(1, Math.min(to, pageCount));
  const lo = Math.min(clampedFrom, clampedTo);
  const hi = Math.max(clampedFrom, clampedTo);
  const count = hi - lo + 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-base border border-border-default rounded-[2px] w-[340px] p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[#d4a017] font-semibold inline-flex items-center gap-1.5">
            <FileOutput className="w-3.5 h-3.5" /> Export page range
          </div>
          <IconButton onClick={onClose} aria-label="Close" title="Close" className="text-rmpg-400 hover:text-rmpg-100 p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        <div className="text-[10px] text-rmpg-500 mb-3">Document has {pageCount} page{pageCount === 1 ? '' : 's'}. Choose a 1-indexed range to export as a new PDF.</div>

        <div className="flex items-center gap-2 mb-3">
          <label className="text-[10px] text-rmpg-300 flex-1">
            <span className="block text-[9px] uppercase tracking-wider text-rmpg-500 mb-0.5">From</span>
            <input id="ff-exportrange-from" type="number" min={1} max={pageCount} value={from}
              onChange={e => setFrom(parseInt(e.target.value, 10) || 1)}
              className="w-full bg-surface-sunken border border-border-default text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]" />
          </label>
          <label className="text-[10px] text-rmpg-300 flex-1">
            <span className="block text-[9px] uppercase tracking-wider text-rmpg-500 mb-0.5">To</span>
            <input id="ff-exportrange-to" type="number" min={1} max={pageCount} value={to}
              onChange={e => setTo(parseInt(e.target.value, 10) || pageCount)}
              className="w-full bg-surface-sunken border border-border-default text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]" />
          </label>
        </div>

        <div className="text-[10px] text-rmpg-400 mb-3">Will export <span className="text-[#d4a017] font-mono">{count}</span> page{count === 1 ? '' : 's'} (pages {lo}–{hi}).</div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-[11px]">Cancel</button>
          <button type="button" onClick={() => onExport(lo, hi)} className="btn-primary text-[11px]">Export PDF</button>
        </div>
      </div>
    </div>
  );
}
