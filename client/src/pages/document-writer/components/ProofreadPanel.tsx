import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, SpellCheck2, Wand2, Check } from 'lucide-react';
import { proofread, applyProofFix, selectProofIssue, type ProofIssue, type ProofKind } from '../proofread';

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

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const issues = useMemo(() => proofread(editor.getText()), [editor, version]);

  const fixOne = (iss: ProofIssue) => {
    if (applyProofFix(editor, iss)) flash('Fixed.');
    else flash('That spot changed — re-scan and try again.');
  };

  const fixAll = () => {
    // Re-scan + fix repeatedly; each fix shifts offsets, so re-derive between
    // passes. Cap iterations to avoid any pathological loop.
    let fixed = 0;
    for (let pass = 0; pass < 200; pass++) {
      const list = proofread(editor.getText());
      if (list.length === 0) break;
      if (!applyProofFix(editor, list[0])) break;
      fixed++;
    }
    flash(fixed ? `Fixed ${fixed} issue${fixed === 1 ? '' : 's'}.` : 'Nothing to fix.');
  };

  return (
    <div className="w-64 sm:w-72 shrink-0 bg-[#0d0d0d] border border-[#222] rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <SpellCheck2 className="w-3 h-3" /> Proofread
        </span>
        <button type="button" onClick={onClose} aria-label="Close proofread" className="text-[10px] text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>

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
          <div key={`${iss.kind}-${iss.start}-${i}`} className="border border-[#1a1a1a] rounded-[2px] px-1.5 py-1">
            <div className="flex items-center justify-between gap-1">
              <span className={`text-[9px] uppercase font-semibold ${KIND_COLOR[iss.kind]}`}>{KIND_LABEL[iss.kind]}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => selectProofIssue(editor, iss)} title="Show in document"
                  className="text-[9px] text-rmpg-500 hover:text-rmpg-200">show</button>
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
