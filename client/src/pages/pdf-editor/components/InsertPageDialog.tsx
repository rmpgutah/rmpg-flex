import { X, FilePlus2, AlignJustify, Grid3x3, Image as ImageIcon } from 'lucide-react';

// Insert-page dialog: blank / lined / grid template pages, or an image as a
// full new page. The chosen page is appended to the end of the document.

interface Props {
  open: boolean;
  onClose: () => void;
  onTemplate: (t: 'blank' | 'lined' | 'grid') => void;
  onPickImage: () => void;
}

const cardCls = 'flex flex-col items-center justify-center gap-1.5 border border-border-default hover:border-[#d4a017] rounded-[2px] py-4 text-[10px] text-rmpg-300 hover:text-rmpg-100 bg-surface-sunken';

export default function InsertPageDialog({ open, onClose, onTemplate, onPickImage }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-base border border-border-default rounded-[2px] w-[400px] max-w-full p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <FilePlus2 className="w-4 h-4 text-[#d4a017]" />
          <div className="text-sm text-rmpg-100 font-semibold">Insert New Page</div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto text-rmpg-400 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-[10px] text-rmpg-500 mb-3">A new US-Letter page is appended to the end of the document.</div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={cardCls} onClick={() => { onTemplate('blank'); onClose(); }}>
            <FilePlus2 className="w-6 h-6 text-rmpg-400" /> Blank
          </button>
          <button type="button" className={cardCls} onClick={() => { onTemplate('lined'); onClose(); }}>
            <AlignJustify className="w-6 h-6 text-rmpg-400" /> Lined
          </button>
          <button type="button" className={cardCls} onClick={() => { onTemplate('grid'); onClose(); }}>
            <Grid3x3 className="w-6 h-6 text-rmpg-400" /> Grid
          </button>
          <button type="button" className={cardCls} onClick={() => { onPickImage(); onClose(); }}>
            <ImageIcon className="w-6 h-6 text-rmpg-400" /> From image…
          </button>
        </div>
      </div>
    </div>
  );
}
