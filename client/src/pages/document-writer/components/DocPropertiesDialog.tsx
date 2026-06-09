import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Info, X } from 'lucide-react';
import type { DocProperties } from '../types';

/** Document Properties editor — title / author / subject / keywords / category.
 *  Persisted into docSettings.properties (and from there into the printed/PDF
 *  <head> metadata and a round-trip HTML comment). Read-only stats are shown for
 *  context. */
export default function DocPropertiesDialog({
  value, defaultAuthor, editor, onSave, onClose,
}: {
  value: DocProperties;
  defaultAuthor: string;
  editor: Editor | null;
  onSave: (props: DocProperties) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DocProperties>({
    ...value,
    author: value.author || defaultAuthor,
  });

  const set = (k: keyof DocProperties, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const text = editor?.state.doc.textContent || '';
  const wordCount = (text.trim().match(/\S+/g) || []).length;

  const field = 'w-full bg-[#141414] border border-[#222] text-rmpg-100 text-[12px] rounded-[2px] px-2 py-1.5 focus:outline-none focus:border-[#d4a017]/50';
  const lbl = 'text-[10px] text-rmpg-400 uppercase tracking-wide mb-1 block';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md bg-[#0a0a0a] border border-[#2e2e2e] rounded-[2px] shadow-2xl shadow-black/70" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a1a]">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-rmpg-100 uppercase tracking-wide">
            <Info className="w-3.5 h-3.5 text-[#d4a017]" /> Document Properties
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-rmpg-500 hover:text-rmpg-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-3 space-y-3">
          <div>
            <label className={lbl}>Title</label>
            <input className={field} value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Document title" />
          </div>
          <div>
            <label className={lbl}>Author</label>
            <input className={field} value={draft.author} onChange={(e) => set('author', e.target.value)} placeholder="Author name" />
          </div>
          <div>
            <label className={lbl}>Subject</label>
            <input className={field} value={draft.subject} onChange={(e) => set('subject', e.target.value)} placeholder="What this document is about" />
          </div>
          <div>
            <label className={lbl}>Keywords</label>
            <input className={field} value={draft.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="comma, separated, keywords" />
          </div>
          <div>
            <label className={lbl}>Category</label>
            <input className={field} value={draft.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Incident, Memo, Warrant" />
          </div>

          <div className="text-[10px] text-rmpg-500 border-t border-[#1a1a1a] pt-2 flex gap-4">
            <span><span className="text-rmpg-300 tabular-nums">{wordCount}</span> words</span>
            <span><span className="text-rmpg-300 tabular-nums">{text.length}</span> characters</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[#1a1a1a]">
          <button type="button" onClick={onClose} className="px-2.5 py-1 text-[11px] bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">Cancel</button>
          <button type="button" onClick={() => { onSave(draft); onClose(); }} className="px-2.5 py-1 text-[11px] font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20">Save</button>
        </div>
      </div>
    </div>
  );
}
