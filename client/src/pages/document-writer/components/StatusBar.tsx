import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Target } from 'lucide-react';
import { computeStats, getWordGoal, setWordGoal, type DocStats } from '../docActions';
import PromptDialog from '../../../components/PromptDialog';

/** Live document status bar — word / character counts, reading time, and average
 *  words-per-sentence, refreshed on every editor transaction. Sits below the page
 *  so the writer always has a glanceable read on document length without opening
 *  the statistics dropdown. */
export default function StatusBar({ editor }: { editor: Editor }) {
  const [stats, setStats] = useState<DocStats>(() => computeStats(editor));
  const [goal, setGoal] = useState<number>(() => getWordGoal());
  const [goalOpen, setGoalOpen] = useState(false);

  const editGoal = () => setGoalOpen(true);
  const pct = goal > 0 ? Math.min(100, Math.round((stats.words / goal) * 100)) : 0;

  useEffect(() => {
    const update = () => setStats(computeStats(editor));
    editor.on('update', update);
    editor.on('selectionUpdate', update);
    update();
    return () => {
      editor.off('update', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  const sel = editor.state.selection;
  const hasSelection = sel.from !== sel.to;
  const selectedWords = hasSelection
    ? (editor.state.doc.textBetween(sel.from, sel.to, ' ').trim().match(/\S+/g) || []).length
    : 0;

  const Item = ({ label, value }: { label: string; value: string | number }) => (
    <span className="whitespace-nowrap">
      <span className="text-rmpg-200 tabular-nums">{value}</span>
      <span className="text-rmpg-600 ml-1">{label}</span>
    </span>
  );

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[10px] px-2 py-1 bg-surface-base border border-border-default rounded-[2px]">
      <Item label="words" value={stats.words} />
      <Item label="characters" value={stats.characters} />
      <Item label="sentences" value={stats.sentences} />
      <Item label="paragraphs" value={stats.paragraphs} />
      <Item label={`min read (${stats.avgWordsPerSentence} avg w/sent)`} value={stats.readingMinutes} />
      <button type="button" onClick={editGoal}
        title="Set a word-count goal"
        className="flex items-center gap-1.5 whitespace-nowrap hover:text-accent-silver-300 group">
        <Target className="w-3 h-3 text-rmpg-500 group-hover:text-accent-silver-300" />
        {goal > 0 ? (
          <>
            <span className="w-16 h-1.5 bg-surface-raised rounded-full overflow-hidden inline-block">
              <span className="block h-full bg-accent-silver-500" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-rmpg-300 tabular-nums">{pct}%</span>
            <span className="text-rmpg-600">of {goal.toLocaleString()}</span>
          </>
        ) : (
          <span className="text-rmpg-500">set goal</span>
        )}
      </button>
      {hasSelection && (
        <span className="whitespace-nowrap ml-auto text-rmpg-100">
          <span className="tabular-nums">{selectedWords}</span>
          <span className="ml-1 opacity-80">words selected</span>
        </span>
      )}
      <PromptDialog
        isOpen={goalOpen}
        onClose={() => setGoalOpen(false)}
        onSubmit={(input) => {
          const n = Math.max(0, Math.round(Number(input) || 0));
          setWordGoal(n);
          setGoal(n);
          setGoalOpen(false);
        }}
        title="Word-count goal"
        message="Enter a target word count. Blank or 0 clears the goal."
        label="Goal"
        defaultValue={goal ? String(goal) : ''}
        allowEmpty
        inputType="number"
        inputMode="numeric"
        confirmLabel="Set"
      />
    </div>
  );
}
