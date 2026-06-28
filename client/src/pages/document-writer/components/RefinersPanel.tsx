import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { X, Sparkles, Loader2, Check, Copy, RotateCcw, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface Props {
  editor: Editor | null;
  onClose: () => void;
  flash: (msg: string) => void;
}

interface RefineAction {
  id: string;
  label: string;
  description: string;
  group: string;
}

const ACTIONS: RefineAction[] = [
  { id: 'improve-clarity',    label: 'Improve Clarity',        description: 'Simplify and clarify without losing facts',        group: 'Polish' },
  { id: 'formal-legal-tone',  label: 'Formal Legal Tone',      description: 'Elevate to court/affidavit register',              group: 'Polish' },
  { id: 'brevity',            label: 'Make Concise',           description: 'Cut redundancy, preserve substance',               group: 'Polish' },
  { id: 'first-person',       label: 'First-Person Active',    description: 'Convert to "I observed / I contacted" voice',      group: 'Polish' },
  { id: 'probable-cause',     label: 'Strengthen P.C.',        description: 'Sharpen probable cause articulation (4th Amend.)', group: 'Law Enforcement' },
  { id: 'miranda-check',      label: 'Miranda Check',          description: 'Verify / correct Miranda advisement language',     group: 'Law Enforcement' },
  { id: 'summarize',          label: 'Summarize',              description: '2-4 sentence synopsis for a case brief',           group: 'Transform' },
  { id: 'expand',             label: 'Expand',                 description: 'Add detail with [placeholder] prompts',            group: 'Transform' },
];

const GROUPS = ['Polish', 'Law Enforcement', 'Transform'];

export default function RefinersPanel({ editor, onClose, flash }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const getSelectedOrAll = (): string => {
    if (!editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (!empty) return editor.state.doc.textBetween(from, to, '\n');
    return editor.getText();
  };

  const runRefine = async (action: RefineAction) => {
    const text = getSelectedOrAll();
    if (!text.trim()) { flash('Select text (or place cursor to refine the whole document)'); return; }
    setLoading(true);
    setResult(null);
    setError(null);
    setApplied(false);
    setLastAction(action.label);
    setSourceText(text.slice(0, 200) + (text.length > 200 ? '…' : ''));
    try {
      const data = await apiFetch<{ result: string }>('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, action: action.id }),
      });
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refine failed');
    } finally {
      setLoading(false);
    }
  };

  const applyResult = () => {
    if (!editor || !result) return;
    const { from, to, empty } = editor.state.selection;
    if (!empty) {
      editor.chain().focus().insertContentAt({ from, to }, result.split('\n').map((l) => `<p>${l}</p>`).join('')).run();
    } else {
      editor.chain().focus().setContent(result.split('\n').map((l) => `<p>${l}</p>`).join('')).run();
    }
    setApplied(true);
    flash(`Applied "${lastAction}"`);
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result).catch(() => { /* noop */ });
    flash('Copied to clipboard');
  };

  return (
    <div className="w-64 flex-shrink-0 bg-surface-raised border border-border-default rounded-[2px] flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-surface-base">
        <Sparkles className="w-3.5 h-3.5 text-[#d4a017]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-rmpg-300 flex-1">AI Refiners</span>
        <button type="button" aria-label="Close AI Refiners" onClick={onClose} className="text-rmpg-500 hover:text-rmpg-200">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-3">
        <p className="text-[9px] text-rmpg-500 leading-relaxed">
          Select text for targeted refinement, or leave unselected to refine the whole document.
        </p>

        {GROUPS.map((group) => (
          <div key={group}>
            <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-semibold mb-1 px-1">{group}</div>
            <div className="space-y-0.5">
              {ACTIONS.filter((a) => a.group === group).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={loading}
                  onClick={() => runRefine(action)}
                  title={action.description}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[2px] text-left hover:bg-surface-base group disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="w-3 h-3 text-rmpg-600 group-hover:text-[#d4a017] flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-rmpg-300 group-hover:text-rmpg-100 font-medium truncate">{action.label}</div>
                    <div className="text-[9px] text-rmpg-600 leading-tight truncate">{action.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Result area */}
      {(loading || result || error) && (
        <div className="border-t border-border-default p-2 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-[10px] text-rmpg-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#d4a017]" />
              <span>Running <em>{lastAction}</em>…</span>
            </div>
          )}
          {error && (
            <div className="text-[10px] text-red-400 bg-red-900/20 border border-red-700/30 rounded-[2px] px-2 py-1.5">
              {error}
              <button type="button" onClick={() => setError(null)} className="ml-2 underline text-red-300 hover:text-red-200">Dismiss</button>
            </div>
          )}
          {result && !loading && (
            <div className="space-y-1.5">
              {sourceText && (
                <div className="text-[9px] text-rmpg-600">
                  <span className="font-medium text-rmpg-500">From:</span> {sourceText}
                </div>
              )}
              <div className="text-[9px] text-rmpg-500 font-medium">Result ({lastAction}):</div>
              <div className="bg-surface-sunken border border-border-default rounded-[2px] p-2 text-[10px] text-rmpg-200 max-h-36 overflow-auto whitespace-pre-wrap leading-relaxed">
                {result}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={applyResult}
                  disabled={applied}
                  className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  {applied ? 'Applied' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={copyResult}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-rmpg-400 hover:text-rmpg-200 border border-border-default rounded-[2px] hover:border-border-hover"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => { setResult(null); setApplied(false); setError(null); }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-rmpg-500 hover:text-rmpg-300"
                >
                  <RotateCcw className="w-3 h-3" />
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
