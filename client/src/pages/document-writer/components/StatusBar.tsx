import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { computeStats, type DocStats } from '../docActions';

/** Live document status bar — word / character counts, reading time, and average
 *  words-per-sentence, refreshed on every editor transaction. Sits below the page
 *  so the writer always has a glanceable read on document length without opening
 *  the statistics dropdown. */
export default function StatusBar({ editor }: { editor: Editor }) {
  const [stats, setStats] = useState<DocStats>(() => computeStats(editor));

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
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[10px] px-2 py-1 bg-[#0d0d0d] border border-[#222] rounded-[2px]">
      <Item label="words" value={stats.words} />
      <Item label="characters" value={stats.characters} />
      <Item label="sentences" value={stats.sentences} />
      <Item label="paragraphs" value={stats.paragraphs} />
      <Item label={`min read (${stats.avgWordsPerSentence} avg w/sent)`} value={stats.readingMinutes} />
      {hasSelection && (
        <span className="whitespace-nowrap ml-auto text-[#d4a017]">
          <span className="tabular-nums">{selectedWords}</span>
          <span className="ml-1 opacity-80">words selected</span>
        </span>
      )}
    </div>
  );
}
