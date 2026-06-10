import { useRef, useState } from 'react';
import { FilePlus2, X, Upload as UploadIcon } from 'lucide-react';

// Insert the pages of another PDF at a chosen position in the current document.
// Distinct from "Append PDF" (always end) and "Insert page" (blank/image/grid).
// The operator picks a source PDF and the 1-indexed position to insert BEFORE.
// All work happens locally via pdf-lib in the caller (insertPdfBytesAt).

interface Props {
  open: boolean;
  pageCount: number;
  activePage: number;
  busy?: boolean;
  onClose: () => void;
  onInsert: (file: File, position: number) => void;
}

const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';
const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5';

export default function InsertFromPdfDialog({ open, pageCount, activePage, busy, onClose, onInsert }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [where, setWhere] = useState<'before' | 'after' | 'start' | 'end'>('after');

  if (!open) return null;

  // Resolve the human placement choice to a 1-indexed "insert before" position.
  const resolvePosition = (): number => {
    if (where === 'start') return 1;
    if (where === 'end') return pageCount + 1;
    if (where === 'before') return Math.max(1, activePage);
    return Math.max(1, activePage) + 1; // after current page
  };

  const doInsert = () => {
    if (!file) return;
    onInsert(file, resolvePosition());
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#141414] border border-[#222] rounded-[2px] p-4 max-w-[440px] w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white inline-flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-[#d4a017]" /> Insert pages from another PDF
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-[10px] text-rmpg-400 mb-3">
          Splice every page of another PDF into this document at a chosen spot.
          Existing annotations are flattened into the document first, then the
          combined result re-opens for further editing.
        </p>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>Source PDF</label>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0] ?? null; setFile(f); e.target.value = ''; }} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="w-full text-left px-2 py-1.5 border border-[#222] rounded-sm text-[11px] text-rmpg-300 hover:text-white inline-flex items-center gap-2">
              <UploadIcon className="w-3.5 h-3.5" />
              {file ? file.name : 'Choose a PDF…'}
            </button>
          </div>

          <div>
            <label className={labelCls}>Insert position</label>
            <select id="ff-insertfrompdf-where" value={where} onChange={e => setWhere(e.target.value as typeof where)} className={inputCls}>
              <option value="after">After current page ({activePage})</option>
              <option value="before">Before current page ({activePage})</option>
              <option value="start">At the very beginning</option>
              <option value="end">At the very end</option>
            </select>
            <div className="text-[9px] text-rmpg-600 mt-1">
              Current document: {pageCount} page{pageCount === 1 ? '' : 's'}. Inserting before page {resolvePosition()}.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button type="button" onClick={doInsert} disabled={!file || busy}
            className="btn-primary text-[11px] px-3 py-1 disabled:opacity-40">
            {busy ? 'Inserting…' : 'Insert pages'}
          </button>
          <button type="button" onClick={onClose} className="ml-auto text-[11px] text-rmpg-400 hover:text-white px-2 py-1">Cancel</button>
        </div>
      </div>
    </div>
  );
}
