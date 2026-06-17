import { useState } from 'react';
import { Wrench, X, Scissors, Minimize2, Ruler, Contrast } from 'lucide-react';
import IconButton from '../../../components/IconButton';
import { PAGE_SIZE_PRESETS } from '../save';

interface Props {
  open: boolean;
  onClose: () => void;
  pageCount: number;
  selectedCount: number;
  activePage: number;
  busy: boolean;
  onSplitEveryN: (n: number) => void;
  onSplitAtSelected: () => void;
  onOptimize: () => void;
  onResize: (size: keyof typeof PAGE_SIZE_PRESETS, targetAll: boolean) => void;
  onGrayscale: () => void;
  onInvert: () => void;
}

const sizeNames = Object.keys(PAGE_SIZE_PRESETS) as Array<keyof typeof PAGE_SIZE_PRESETS>;

/** Multi-tool dialog for document-level operations that don't belong on the
 *  per-annotation properties panel: split, optimize/compress, page resize, and
 *  grayscale/invert. Pure UI — every action runs in the parent. */
export default function PdfToolsDialog(p: Props) {
  const [everyN, setEveryN] = useState(1);
  const [size, setSize] = useState<keyof typeof PAGE_SIZE_PRESETS>('Letter');
  if (!p.open) return null;

  const sectionTitle = 'text-[10px] uppercase tracking-wider text-[#d4a017] font-semibold mb-1.5';
  const hint = 'text-[9px] text-rmpg-600';
  const input = 'bg-[#0a0a0a] border border-[#222] text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={p.onClose}>
      <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[400px] max-h-[85vh] overflow-y-auto p-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-[#d4a017] font-semibold inline-flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" /> PDF Tools
          </div>
          <IconButton onClick={p.onClose} aria-label="Close" title="Close" className="text-rmpg-400 hover:text-rmpg-100 p-1"><X className="w-4 h-4" /></IconButton>
        </div>

        {/* Split */}
        <div className="border border-[#1a1a1a] rounded-sm p-3 mb-3">
          <div className={sectionTitle}><span className="inline-flex items-center gap-1"><Scissors className="w-3 h-3" /> Split into multiple files</span></div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-rmpg-300">Every</span>
            <input id="ff-tools-everyn" type="number" min={1} max={Math.max(1, p.pageCount)} value={everyN}
              onChange={e => setEveryN(Math.max(1, parseInt(e.target.value, 10) || 1))} className={`${input} w-16`} />
            <span className="text-[10px] text-rmpg-300">page(s)</span>
            <button type="button" disabled={p.busy} onClick={() => p.onSplitEveryN(everyN)} className="btn-secondary text-[10px] ml-auto disabled:opacity-40">Split</button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-rmpg-400">At {p.selectedCount} selected page boundary(ies)</span>
            <button type="button" disabled={p.busy || p.selectedCount === 0} onClick={p.onSplitAtSelected} className="btn-secondary text-[10px] disabled:opacity-40">Split at selected</button>
          </div>
          <div className={`${hint} mt-1`}>Each part downloads as its own PDF.</div>
        </div>

        {/* Optimize */}
        <div className="border border-[#1a1a1a] rounded-sm p-3 mb-3">
          <div className={sectionTitle}><span className="inline-flex items-center gap-1"><Minimize2 className="w-3 h-3" /> Optimize / compress</span></div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-rmpg-400">Re-encode with object streams</span>
            <button type="button" disabled={p.busy} onClick={p.onOptimize} className="btn-secondary text-[10px] disabled:opacity-40">Optimize</button>
          </div>
          <div className={`${hint} mt-1`}>Shows the before / after size. Keeps the smaller result.</div>
        </div>

        {/* Page size */}
        <div className="border border-[#1a1a1a] rounded-sm p-3 mb-3">
          <div className={sectionTitle}><span className="inline-flex items-center gap-1"><Ruler className="w-3 h-3" /> Set page size</span></div>
          <div className="flex items-center gap-2 mb-2">
            <select id="ff-tools-size" value={size} onChange={e => setSize(e.target.value as keyof typeof PAGE_SIZE_PRESETS)} className={`${input} flex-1`}>
              {sizeNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={p.busy} onClick={() => p.onResize(size, true)} className="btn-secondary text-[10px] flex-1 disabled:opacity-40">All pages</button>
            <button type="button" disabled={p.busy || p.selectedCount === 0} onClick={() => p.onResize(size, false)} className="btn-secondary text-[10px] flex-1 disabled:opacity-40">Selected ({p.selectedCount})</button>
          </div>
          <div className={`${hint} mt-1`}>Content is scaled to fit + centered; reopens the resized document.</div>
        </div>

        {/* Grayscale / invert */}
        <div className="border border-[#1a1a1a] rounded-sm p-3">
          <div className={sectionTitle}><span className="inline-flex items-center gap-1"><Contrast className="w-3 h-3" /> Grayscale / invert page {p.activePage}</span></div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={p.busy} onClick={p.onGrayscale} className="btn-secondary text-[10px] flex-1 disabled:opacity-40">Grayscale</button>
            <button type="button" disabled={p.busy} onClick={p.onInvert} className="btn-secondary text-[10px] flex-1 disabled:opacity-40">Invert</button>
          </div>
          <div className={`${hint} mt-1`}>Renders the current page, processes pixels, and appends the result as a new page.</div>
        </div>
      </div>
    </div>
  );
}
