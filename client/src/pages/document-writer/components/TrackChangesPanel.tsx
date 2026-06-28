import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, GitPullRequestArrow, Check, Undo2, Pencil } from 'lucide-react';
import { countSuggestions, resolveAllSuggestions } from '../trackChanges';

/** Track-changes (suggestion mode) control panel.
 *
 *  When suggestion mode is ON, the page wraps newly typed text in the
 *  `suggestion` insertion mark (green underline). Selecting text and clicking
 *  "Mark deletion" tags it as a proposed deletion (red strike). Accept keeps
 *  insertions / removes deletions; Reject does the inverse. */
export default function TrackChangesPanel({
  editor, suggestMode, onToggleMode, onClose, flash,
}: {
  editor: Editor;
  suggestMode: boolean;
  onToggleMode: () => void;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    editor.on('selectionUpdate', bump);
    return () => { editor.off('update', bump); editor.off('selectionUpdate', bump); };
  }, [editor]);

  const counts = useMemo(() => countSuggestions(editor), [editor, version]);
  const pending = counts.insertions + counts.deletions;

  const markDeletion = () => {
    const { from, to } = editor.state.selection;
    if (from === to) { flash('Select text to mark as a proposed deletion.'); return; }
    editor.chain().focus().markDeletion().run();
  };

  const resolve = (mode: 'accept' | 'reject') => {
    resolveAllSuggestions(editor, mode);
    flash(mode === 'accept' ? 'Accepted all tracked changes.' : 'Rejected all tracked changes.');
  };

  return (
    <div className="w-60 sm:w-64 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <GitPullRequestArrow className="w-3 h-3" /> Track Changes
        </span>
        <button type="button" onClick={onClose} aria-label="Close track changes" className="text-[10px] text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>

      <button type="button" onClick={onToggleMode}
        className={`w-full mb-2 px-2 py-1.5 text-[10px] rounded-[2px] border flex items-center justify-center gap-1.5 ${
          suggestMode ? 'bg-[#d4a017]/15 border-[#d4a017]/40 text-[#d4a017]' : 'bg-surface-base border-border-default text-rmpg-300 hover:bg-surface-raised'
        }`}>
        <Pencil className="w-3 h-3" /> Suggestion mode: {suggestMode ? 'ON' : 'OFF'}
      </button>

      <p className="text-[9px] text-rmpg-600 leading-snug mb-2">
        With suggestion mode on, new text you type is tracked as an insertion (green).
        Select text and use "Mark deletion" to propose a removal (red strike).
      </p>

      <button type="button" onClick={markDeletion}
        className="w-full mb-2 px-2 py-1 text-[10px] bg-surface-base border border-border-default text-rmpg-300 rounded-[2px] hover:bg-surface-raised">
        Mark selection as deletion
      </button>

      <div className="text-[10px] text-rmpg-400 mb-1.5 border-t border-border-default pt-2">
        {pending === 0 ? 'No tracked changes pending.' : (
          <span>
            <span className="text-green-400">{counts.insertions} insertion{counts.insertions === 1 ? '' : 's'}</span>
            {' · '}
            <span className="text-red-400">{counts.deletions} deletion{counts.deletions === 1 ? '' : 's'}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button type="button" onClick={() => resolve('accept')} disabled={pending === 0}
          className="flex-1 px-2 py-1.5 text-[10px] bg-green-900/20 border border-green-700/30 text-green-300 rounded-[2px] hover:bg-green-900/30 disabled:opacity-40 flex items-center justify-center gap-1">
          <Check className="w-3 h-3" /> Accept all
        </button>
        <button type="button" onClick={() => resolve('reject')} disabled={pending === 0}
          className="flex-1 px-2 py-1.5 text-[10px] bg-red-900/20 border border-red-700/30 text-red-300 rounded-[2px] hover:bg-red-900/30 disabled:opacity-40 flex items-center justify-center gap-1">
          <Undo2 className="w-3 h-3" /> Reject all
        </button>
      </div>
    </div>
  );
}
