import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { X, ListChecks, Target } from 'lucide-react';
import { computeSectionStats, setSectionGoal, type SectionStat } from '../sectionStats';
import PromptDialog from '../../../components/PromptDialog';

/** Per-heading section word-count panel. Lists every heading-delimited section
 *  with its word count, lets the user set a per-section word goal (shown as a
 *  progress bar), and click a section to scroll the editor to it. */
export default function SectionsPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [version, setVersion] = useState(0);
  const [goalTick, setGoalTick] = useState(0);
  const [goalTarget, setGoalTarget] = useState<SectionStat | null>(null);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  const sections = useMemo(() => computeSectionStats(editor), [editor, version, goalTick]);
  const total = sections.reduce((s, x) => s + x.words, 0);

  const goTo = (s: SectionStat) => {
    if (s.pos > 0) editor.chain().focus().setTextSelection(s.pos + 1).scrollIntoView().run();
  };
  const editGoal = (s: SectionStat) => setGoalTarget(s);

  return (
    <div className="w-56 sm:w-72 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <ListChecks className="w-3 h-3" /> Sections
        </span>
        <button type="button" onClick={onClose} aria-label="Close sections" className="text-[10px] text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="text-[10px] text-rmpg-500 mb-2">
        {sections.length === 0 ? 'No headings yet — add H1–H4 to segment the document.' : `${sections.length} section${sections.length === 1 ? '' : 's'} · ${total} words total`}
      </div>

      <div className="space-y-1.5">
        {sections.map((s, i) => (
          <div key={`${s.title}-${i}`} className="border border-border-default rounded-[2px] px-1.5 py-1">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => goTo(s)} title="Scroll to section"
                className="min-w-0 flex-1 text-left text-[10px] text-rmpg-200 hover:text-accent-silver-300 truncate"
                style={{ paddingLeft: `${Math.max(0, s.level - 1) * 8}px` }}>
                {s.title}
              </button>
              <span className="text-[10px] text-rmpg-400 tabular-nums">{s.words}</span>
              <button type="button" onClick={() => editGoal(s)} title="Set word goal"
                className="text-rmpg-600 hover:text-accent-silver-300"><Target className="w-3 h-3" /></button>
            </div>
            {s.goal > 0 && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                  <span className="block h-full bg-accent-silver-500" style={{ width: `${s.pct}%` }} />
                </span>
                <span className="text-[9px] text-rmpg-500 tabular-nums">{s.pct}% / {s.goal}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <PromptDialog
        isOpen={goalTarget != null}
        onClose={() => setGoalTarget(null)}
        onSubmit={(input) => {
          if (!goalTarget) return;
          setSectionGoal(goalTarget.title, Math.max(0, Math.round(Number(input) || 0)));
          setGoalTick((t) => t + 1);
          setGoalTarget(null);
        }}
        title="Section word goal"
        message={`Word goal for "${goalTarget?.title ?? ''}". Blank or 0 clears the goal.`}
        label="Goal"
        defaultValue={goalTarget?.goal ? String(goalTarget.goal) : ''}
        allowEmpty
        inputType="number"
        inputMode="numeric"
        confirmLabel="Set"
      />
    </div>
  );
}
