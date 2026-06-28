import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, ChevronUp, ChevronDown, ArrowDownAZ } from 'lucide-react';
import { findReplaceKey, type SearchOptions } from '../extensions/findReplace';

const HISTORY_KEY = 'rmpg_writer_search_history';
function pushHistory(term: string) {
  if (!term.trim()) return;
  let h: string[] = [];
  try { h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { /* noop */ }
  h = [term, ...h.filter((t) => t !== term)].slice(0, 10);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* noop */ }
}
function readHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

/** Find & Replace panel (features 1–10). Drives the FindReplace extension. */
export default function FindReplacePanel({
  editor, mode, onClose,
}: { editor: Editor; mode: 'find' | 'replace'; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [opts, setOpts] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false, inSelection: false });
  const [, force] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Re-run search whenever the term or options change.
  useEffect(() => {
    editor.commands.setSearchTerm(term, opts);
    force((n) => n + 1);
  }, [term, opts, editor]);

  useEffect(() => () => { editor.commands.clearSearch(); }, [editor]);

  const state = findReplaceKey.getState(editor.state);
  const total = state?.matches.length ?? 0;
  const current = state && state.current >= 0 ? state.current + 1 : 0;

  const toggle = (k: keyof SearchOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }));
  const next = () => { editor.commands.findNext(); force((n) => n + 1); };
  const prev = () => { editor.commands.findPrevious(); force((n) => n + 1); };
  const onSubmit = () => { pushHistory(term); next(); };

  const optBtn = (k: keyof SearchOptions, label: string, title: string) => (
    <button type="button" title={title} onClick={() => toggle(k)}
      className={`px-1.5 py-0.5 text-[10px] rounded-[2px] border ${opts[k] ? 'bg-[#d4a017]/20 border-[#d4a017]/40 text-[#d4a017]' : 'border-border-default text-rmpg-400 hover:bg-surface-raised'}`}>
      {label}
    </button>
  );

  return (
    <div className="absolute top-2 left-2 right-2 sm:left-auto z-40 w-auto sm:w-[340px] max-w-[calc(100vw-1rem)] bg-surface-base border border-rmpg-700 rounded-[2px] shadow-2xl shadow-black/60 p-2 space-y-1.5">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef} list="rmpg-search-history" value={term} onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prev() : onSubmit(); } if (e.key === 'Escape') onClose(); }}
          placeholder="Find" className="flex-1 bg-surface-base border border-border-default text-[11px] text-rmpg-100 rounded-[2px] px-2 py-1 focus:outline-none focus:border-[#d4a017]/50"
        />
        <datalist id="rmpg-search-history">{readHistory().map((h) => <option key={h} value={h} />)}</datalist>
        <span className="text-[10px] text-rmpg-500 w-14 text-center tabular-nums">{total ? `${current}/${total}` : '0'}</span>
        <button type="button" onClick={prev} title="Previous (Shift+Enter)" className="p-1 text-rmpg-400 hover:text-rmpg-100"><ChevronUp className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={next} title="Next (Enter)" className="p-1 text-rmpg-400 hover:text-rmpg-100"><ChevronDown className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={onClose} title="Close (Esc)" className="p-1 text-rmpg-400 hover:text-rmpg-100"><X className="w-3.5 h-3.5" /></button>
      </div>

      {mode === 'replace' && (
        <div className="flex items-center gap-1">
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Replace with"
            className="flex-1 bg-surface-base border border-border-default text-[11px] text-rmpg-100 rounded-[2px] px-2 py-1 focus:outline-none focus:border-[#d4a017]/50" />
          <button type="button" onClick={() => { editor.commands.replaceCurrent(replacement); editor.commands.setSearchTerm(term, opts); force((n) => n + 1); }}
            className="px-2 py-1 text-[10px] bg-surface-base border border-border-default text-rmpg-300 rounded-[2px] hover:bg-surface-raised">Replace</button>
          <button type="button" onClick={() => { editor.commands.replaceAll(replacement); force((n) => n + 1); }}
            className="px-2 py-1 text-[10px] bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 flex items-center gap-1"><ArrowDownAZ className="w-3 h-3" />All</button>
        </div>
      )}

      <div className="flex items-center gap-1">
        {optBtn('caseSensitive', 'Aa', 'Match case')}
        {optBtn('wholeWord', 'W', 'Whole word')}
        {optBtn('regex', '.*', 'Regular expression')}
        {optBtn('inSelection', 'Sel', 'Find in selection')}
      </div>
    </div>
  );
}
