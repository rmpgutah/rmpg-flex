import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, GripVertical, ChevronUp, ChevronDown, ListTree } from 'lucide-react';
import { collectSections, moveSection } from '../docFeatures';

/** Drag-reorder (or arrow-reorder) the document's heading sections. Moving a
 *  heading carries its whole section (everything up to the next same-or-higher
 *  heading) with it. Real edits to the TipTap document. */
export default function OutlineReorder({
  editor, onClose, flash,
}: {
  editor: Editor;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const sections = useMemo(() => collectSections(editor), [editor, version]);

  const move = (index: number, dir: 'up' | 'down') => {
    if (moveSection(editor, index, dir)) flash('Section moved.');
    else flash('Cannot move that section any further.');
  };

  const onDrop = (target: number) => {
    if (dragIndex === null || dragIndex === target) { setDragIndex(null); return; }
    // Step the dragged section toward the target one swap at a time so each
    // intermediate move stays valid against fresh positions.
    let cur = dragIndex;
    const dir = target > cur ? 'down' : 'up';
    let guard = 0;
    while (cur !== target && guard < 100) {
      if (!moveSection(editor, cur, dir)) break;
      cur += dir === 'down' ? 1 : -1;
      guard++;
    }
    setDragIndex(null);
    flash('Section reordered.');
  };

  return (
    <div className="w-44 sm:w-60 shrink-0 bg-[#0d0d0d] border border-[#222] rounded-[2px] p-2 overflow-auto">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <ListTree className="w-3 h-3" /> Reorder
        </span>
        <button type="button" onClick={onClose} aria-label="Close reorder" className="text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>
      {sections.length === 0 && <div className="text-[10px] text-rmpg-600 italic">Add headings to reorder sections.</div>}
      {sections.length === 1 && <div className="text-[10px] text-rmpg-600 italic">Only one section — add more headings to reorder.</div>}
      <div className="space-y-0.5">
        {sections.map((s, i) => (
          <div
            key={`${s.from}-${i}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className={`group flex items-center gap-1 rounded-[2px] px-1 py-1 border ${
              dragIndex === i ? 'border-[#d4a017]/50 bg-[#d4a017]/10' : 'border-transparent hover:bg-[#141414]'
            }`}
            style={{ paddingLeft: 4 + (s.level - 1) * 10 }}
            title="Drag to reorder, or use the arrows"
          >
            <GripVertical className="w-3 h-3 text-rmpg-600 group-hover:text-rmpg-400 cursor-grab shrink-0" />
            <span className="flex-1 text-[11px] text-rmpg-300 truncate">
              {s.text || <span className="italic opacity-50">(empty heading)</span>}
            </span>
            <button type="button" onClick={() => move(i, 'up')} disabled={i === 0}
              aria-label="Move section up" className="text-rmpg-500 hover:text-[#d4a017] disabled:opacity-20">
              <ChevronUp className="w-3 h-3" />
            </button>
            <button type="button" onClick={() => move(i, 'down')} disabled={i === sections.length - 1}
              aria-label="Move section down" className="text-rmpg-500 hover:text-[#d4a017] disabled:opacity-20">
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
