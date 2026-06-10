import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Gauge, X } from 'lucide-react';

/** A word / character limit indicator. The user sets a target word count and an
 *  optional hard character cap; this bar shows live progress and warns (amber)
 *  as the count approaches the limit and turns red once exceeded. Real, wired,
 *  recomputed on every editor update. */
export default function WordLimitBar({
  editor, mode, limit, onClose,
}: {
  editor: Editor;
  mode: 'words' | 'characters';
  limit: number;
  onClose: () => void;
}) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    editor.on('selectionUpdate', bump);
    return () => { editor.off('update', bump); editor.off('selectionUpdate', bump); };
  }, [editor]);

  const count = useMemo(() => {
    const text = editor.getText();
    if (mode === 'characters') return text.length;
    return (text.trim().match(/\S+/g) || []).length;
  }, [editor, mode, editor.state]); // editor.state forces a fresh read each render

  const pct = limit > 0 ? Math.min(1, count / limit) : 0;
  const over = count > limit;
  const near = !over && pct >= 0.9;
  const remaining = limit - count;

  const barColor = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-[#d4a017]';
  const textColor = over ? 'text-red-400' : near ? 'text-amber-400' : 'text-rmpg-300';

  return (
    <div className="flex items-center gap-2 bg-[#0d0d0d] border border-[#222] rounded-[2px] px-2 py-1 mt-1.5">
      <Gauge className={`w-3.5 h-3.5 ${textColor} shrink-0`} />
      <span className={`text-[10px] font-medium ${textColor} whitespace-nowrap`}>
        {count.toLocaleString()} / {limit.toLocaleString()} {mode === 'words' ? 'words' : 'chars'}
      </span>
      <div className="flex-1 h-1.5 bg-[#141414] border border-[#1a1a1a] rounded-[2px] overflow-hidden min-w-[80px]">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className={`text-[10px] ${textColor} whitespace-nowrap`}>
        {over ? `${Math.abs(remaining).toLocaleString()} over` : `${remaining.toLocaleString()} left`}
      </span>
      {over && <span className="text-[9px] text-red-400 font-semibold uppercase">Limit exceeded</span>}
      <button type="button" onClick={onClose} aria-label="Hide limit indicator" className="text-rmpg-500 hover:text-rmpg-200 shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
