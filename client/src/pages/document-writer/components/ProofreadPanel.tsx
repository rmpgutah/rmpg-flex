import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, SpellCheck2, Wand2, Check, BookPlus, BookMarked, Trash2 } from 'lucide-react';
import { proofread, applyProofFix, selectProofIssue, type ProofIssue, type ProofKind } from '../proofread';
import { filterIgnoredIssues, addToDictionary, listDictionary, removeFromDictionary } from '../dictionary';

const KIND_LABEL: Record<ProofKind, string> = {
  'repeated-word': 'Repeat',
  'a-an': 'A / An',
  'double-space': 'Spacing',
  'space-before-punct': 'Punct.',
  'sentence-cap': 'Capital',
  'lowercase-i': 'Pronoun',
};
const KIND_COLOR: Record<ProofKind, string> = {
  'repeated-word': 'text-amber-400',
  'a-an': 'text-sky-400',
  'double-space': 'text-rmpg-400',
  'space-before-punct': 'text-orange-400',
  'sentence-cap': 'text-violet-400',
  'lowercase-i': 'text-emerald-400',
};

/** Proofreading side panel — concrete, click-to-fix mechanical errors
 *  (repeated words, a/an, double spaces, sentence capitalization, lone "i",
 *  space-before-punctuation). Recomputes on every editor update. */
export default function ProofreadPanel({
  editor, onClose, flash,
}: { editor: Editor; onClose: () => void; flash: (msg: string) => void }) {
  const [version, setVersion] = useState(0);
  const [dictTick, setDictTick] = useState(0);
  const [showDict, setShowDict] = useState(false);
  const [newWord, setNewWord] = useState('');

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  // Recompute issues, then drop any whose word lives in the custom dictionary.
  const issues = useMemo(
    () => filterIgnoredIssues(proofread(editor.getText())),
    [editor, version, dictTick],
  );
  const dictWords = useMemo(() => listDictionary(), [dictTick, showDict]);

  // Add the flagged word to the ignore list (so it stops being proofed).
  const ignoreIssue = (iss: ProofIssue) => {
    const word = (iss.fix && /[A-Za-z]/.test(iss.fix) ? iss.fix : iss.text).trim();
    if (!word) { flash('Nothing to add.'); return; }
    const n = addToDictionary(word);
    setDictTick((t) => t + 1);
    flash(n ? `Added "${word}" to your dictionary.` : `"${word}" is already in your dictionary.`);
  };
  const addTyped = () => {
    const n = addToDictionary(newWord);
    setNewWord('');
    setDictTick((t) => t + 1);
    flash(n ? `Added ${n} word${n === 1 ? '' : 's'} to your dictionary.` : 'Nothing new to add.');
  };
  const dropWord = (w: string) => { removeFromDictionary(w); setDictTick((t) => t + 1); };

  const fixOne = (iss: ProofIssue) => {
    if (applyProofFix(editor, iss)) flash('Fixed.');
    else flash('That spot changed — re-scan and try again.');
  };

  const fixAll = () => {
    // Re-scan + fix repeatedly; each fix shifts offsets, so re-derive between
    // passes. Cap iterations to avoid any pathological loop.
    let fixed = 0;
    for (let pass = 0; pass < 200; pass++) {
      const list = filterIgnoredIssues(proofread(editor.getText()));
      if (list.length === 0) break;
      if (!applyProofFix(editor, list[0])) break;
      fixed++;
    }
    flash(fixed ? `Fixed ${fixed} issue${fixed === 1 ? '' : 's'}.` : 'Nothing to fix.');
  };

  return (
    <div className="w-64 sm:w-72 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <SpellCheck2 className="w-3 h-3" /> Proofread
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setShowDict((v) => !v)} aria-label="Custom dictionary"
            title="Custom dictionary — words the proofreader should ignore"
            className={`text-[10px] hover:text-rmpg-200 ${showDict ? 'text-[#d4a017]' : 'text-rmpg-500'}`}>
            <BookMarked className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close proofread" className="text-[10px] text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {showDict && (
        <div className="mb-2 border border-border-default rounded-[2px] p-1.5 bg-surface-sunken">
          <div className="text-[9px] uppercase font-semibold text-rmpg-400 mb-1 flex items-center gap-1">
            <BookMarked className="w-3 h-3" /> Custom dictionary ({dictWords.length})
          </div>
          <div className="flex items-center gap-1 mb-1.5">
            <input
              value={newWord} onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
              placeholder="Add word(s)…" aria-label="Add word to dictionary"
              className="flex-1 min-w-0 bg-surface-base border border-border-default text-rmpg-200 text-[10px] rounded-[2px] px-1.5 py-0.5 focus:outline-none focus:border-[#d4a017]/50"
            />
            <button type="button" onClick={addTyped} aria-label="Add to dictionary"
              className="px-1.5 py-0.5 text-[10px] bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 flex items-center gap-0.5">
              <BookPlus className="w-3 h-3" />Add
            </button>
          </div>
          {dictWords.length === 0
            ? <div className="text-[9px] text-rmpg-600 italic">No ignored words yet.</div>
            : (
              <div className="flex flex-wrap gap-1">
                {dictWords.map((w) => (
                  <span key={w} className="inline-flex items-center gap-0.5 text-[10px] text-rmpg-200 bg-surface-base border border-border-default rounded-[2px] pl-1.5 pr-0.5 py-0.5">
                    {w}
                    <button type="button" onClick={() => dropWord(w)} aria-label={`Remove ${w}`}
                      className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-rmpg-400">
          {issues.length === 0 ? 'No issues found.' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}
        </span>
        {issues.length > 0 && (
          <button type="button" onClick={fixAll}
            className="px-2 py-0.5 text-[10px] bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 flex items-center gap-1">
            <Wand2 className="w-3 h-3" /> Fix all
          </button>
        )}
      </div>

      <div className="space-y-1">
        {issues.map((iss, i) => (
          <div key={`${iss.kind}-${iss.start}-${i}`} className="border border-border-default rounded-[2px] px-1.5 py-1">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[9px] uppercase font-semibold ${KIND_COLOR[iss.kind]}`}>{KIND_LABEL[iss.kind]}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => selectProofIssue(editor, iss)} title="Show in document"
                  className="text-[9px] text-rmpg-500 hover:text-rmpg-200">show</button>
                {(iss.kind === 'repeated-word' || iss.kind === 'a-an' || iss.kind === 'sentence-cap' || iss.kind === 'lowercase-i') && (
                  <button type="button" onClick={() => ignoreIssue(iss)} title="Add this word to your dictionary (stop flagging it)"
                    className="text-[9px] text-rmpg-500 hover:text-rmpg-200">ignore</button>
                )}
                <button type="button" onClick={() => fixOne(iss)} title={`Fix → "${iss.fix}"`}
                  className="text-[9px] text-[#d4a017] hover:text-[#e8b830] flex items-center gap-0.5">
                  <Check className="w-2.5 h-2.5" />fix
                </button>
              </div>
            </div>
            <div className="text-[10px] text-rmpg-300 mt-0.5 leading-snug">{iss.message}</div>
          </div>
        ))}
      </div>

      {issues.length === 0 && (
        <p className="text-[9px] text-rmpg-600 mt-2 leading-snug">
          Checks repeated words, a/an agreement, double spaces, space-before-punctuation,
          sentence capitalization, and the lone pronoun "i". Advisory style checks
          (passive voice, long sentences) live in the Analysis panel.
        </p>
      )}
    </div>
  );
}
