import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, Circle, Square, Play, Trash2, Plus } from 'lucide-react';
import {
  MACRO_STEP_LABELS, runMacro, runMacroStep, saveMacro, loadMacro, clearSavedMacro,
  type MacroStep,
} from '../macros';

const PALETTE: MacroStep[] = [
  'bold', 'italic', 'underline', 'strike', 'superscript', 'subscript', 'code',
  'highlight', 'clearMarks', 'h1', 'h2', 'h3', 'paragraph',
  'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
  'bulletList', 'orderedList', 'blockquote',
];

/** Record a short sequence of formatting commands, then replay it onto the
 *  current selection. The sequence is persisted so it survives a reload. While
 *  recording, clicking a command both applies it live AND appends it to the
 *  macro. */
export default function MacroRecorder({
  editor, onClose, flash,
}: {
  editor: Editor;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [steps, setSteps] = useState<MacroStep[]>(() => loadMacro()?.steps ?? []);

  const addStep = (s: MacroStep) => {
    runMacroStep(editor, s); // apply live for immediate feedback
    if (recording) setSteps((prev) => [...prev, s]);
  };

  const stop = () => {
    setRecording(false);
    saveMacro(steps);
    flash(steps.length ? `Macro saved (${steps.length} step${steps.length === 1 ? '' : 's'}).` : 'Macro is empty.');
  };

  const start = () => { setSteps([]); setRecording(true); flash('Recording — click formatting commands to record them.'); };

  const replay = () => {
    if (steps.length === 0) { flash('No macro recorded yet.'); return; }
    runMacro(editor, steps);
    flash(`Replayed ${steps.length} step${steps.length === 1 ? '' : 's'}.`);
  };

  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));
  const clearAll = () => { setSteps([]); clearSavedMacro(); flash('Macro cleared.'); };

  return (
    <div className="w-56 sm:w-64 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide">Macro</span>
        <button type="button" onClick={onClose} aria-label="Close macro recorder" className="text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="flex items-center gap-1 mb-2">
        {recording ? (
          <button type="button" onClick={stop}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-red-900/20 border border-red-700/40 text-red-300 rounded-[2px] hover:bg-red-900/30">
            <Square className="w-3 h-3" /> Stop
          </button>
        ) : (
          <button type="button" onClick={start}
            className="flex items-center gap-1 px-2 py-1 text-[10px] bg-surface-base border border-border-default text-rmpg-300 rounded-[2px] hover:bg-surface-raised">
            <Circle className="w-3 h-3 text-red-400" /> Record
          </button>
        )}
        <button type="button" onClick={replay} disabled={steps.length === 0}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 disabled:opacity-30">
          <Play className="w-3 h-3" /> Replay
        </button>
        <button type="button" onClick={clearAll} disabled={steps.length === 0}
          aria-label="Clear macro" className="ml-auto text-rmpg-500 hover:text-red-400 disabled:opacity-30">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Recorded sequence */}
      <div className="mb-2">
        <div className="text-[9px] uppercase text-rmpg-500 mb-1">Sequence ({steps.length})</div>
        {steps.length === 0
          ? <div className="text-[9px] text-rmpg-600 italic">{recording ? 'Click commands below to record.' : 'Press Record, then click commands.'}</div>
          : (
            <div className="flex flex-wrap gap-1">
              {steps.map((s, i) => (
                <span key={`${s}-${i}`} className="inline-flex items-center gap-0.5 text-[9px] text-rmpg-200 bg-surface-base border border-border-default rounded-[2px] pl-1.5 pr-0.5 py-0.5">
                  {MACRO_STEP_LABELS[s]}
                  <button type="button" onClick={() => removeStep(i)} aria-label={`Remove ${MACRO_STEP_LABELS[s]}`}
                    className="text-rmpg-500 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
      </div>

      {/* Command palette */}
      <div className="text-[9px] uppercase text-rmpg-500 mb-1">Commands {recording && <span className="text-red-400 normal-case">● recording</span>}</div>
      <div className="grid grid-cols-2 gap-1">
        {PALETTE.map((s) => (
          <button key={s} type="button" onClick={() => addStep(s)}
            className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-left text-rmpg-200 bg-surface-base border border-border-default rounded-[2px] hover:bg-surface-raised hover:border-[#d4a017]/30">
            {recording && <Plus className="w-2.5 h-2.5 text-[#d4a017] shrink-0" />}
            <span className="truncate">{MACRO_STEP_LABELS[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
