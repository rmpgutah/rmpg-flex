import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Gauge, AlertTriangle, Hash, GitCompare, FileStack } from 'lucide-react';
import {
  computeReadability, runStyleChecks, wordFrequency, phraseFrequency,
  diffWords, summarizeDiff, estimatePages,
  type StyleIssue, type DiffOp,
} from '../analysis';
import { htmlToPlainText } from '../exporters';

type Tab = 'readability' | 'style' | 'frequency' | 'diff';

/** Document-analysis side panel: readability scores, style checks (passive /
 *  long sentences / filler), word & phrase frequency, and a word-level diff
 *  against a pasted previous version. Recomputes on every editor update. */
export default function AnalysisPanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('readability');
  const [version, setVersion] = useState(0);
  const [prevText, setPrevText] = useState('');

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => { editor.off('update', bump); };
  }, [editor]);

  // Recompute when the document changes (version) or the active tab switches.
  const text = useMemo(() => htmlToPlainText(editor.getHTML()), [editor, version]);
  const readability = useMemo(() => computeReadability(text), [text]);
  const pageEst = useMemo(() => estimatePages(editor), [editor, version]);
  const issues = useMemo(() => runStyleChecks(text), [text]);
  const words = useMemo(() => wordFrequency(text), [text]);
  const phrases = useMemo(() => phraseFrequency(text), [text]);
  const diffOps = useMemo<DiffOp[]>(() => (prevText ? diffWords(prevText, text) : []), [prevText, text]);
  const diffSummary = useMemo(() => summarizeDiff(diffOps), [diffOps]);

  const TabBtn = ({ id, icon: Icon, label }: { id: Tab; icon: typeof Gauge; label: string }) => (
    <button type="button" onClick={() => setTab(id)} title={label}
      className={`flex-1 flex items-center justify-center gap-1 py-1 text-[9px] rounded-[2px] ${
        tab === id ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised'
      }`}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );

  const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div className="flex items-baseline justify-between border-b border-border-subtle py-1">
      <span className="text-[10px] text-rmpg-500">{label}</span>
      <span className="text-[11px] text-rmpg-100 tabular-nums">{value}{hint && <span className="text-rmpg-600 ml-1 text-[9px]">{hint}</span>}</span>
    </div>
  );

  const issueColor = (k: StyleIssue['kind']) =>
    k === 'passive' ? 'text-amber-400' : k === 'long' ? 'text-orange-400' : 'text-sky-400';

  return (
    <div className="w-56 sm:w-72 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <Gauge className="w-3 h-3" /> Analysis
        </span>
        <button type="button" onClick={onClose} className="text-[10px] text-rmpg-500 hover:text-rmpg-200">✕</button>
      </div>

      <div className="flex items-center gap-1 mb-2">
        <TabBtn id="readability" icon={Gauge} label="Score" />
        <TabBtn id="style" icon={AlertTriangle} label="Style" />
        <TabBtn id="frequency" icon={Hash} label="Words" />
        <TabBtn id="diff" icon={GitCompare} label="Diff" />
      </div>

      {tab === 'readability' && (
        <div>
          <div className="bg-surface-base border border-border-default rounded-[2px] p-2 mb-2 text-center">
            <div className="text-2xl font-bold text-[#d4a017] tabular-nums">{readability.fleschReadingEase}</div>
            <div className="text-[9px] text-rmpg-400 uppercase tracking-wide">Flesch Reading Ease</div>
            <div className="text-[10px] text-rmpg-200 mt-0.5">{readability.ease}</div>
          </div>
          <Stat label="Flesch-Kincaid grade" value={readability.fleschKincaidGrade} hint="US grade" />
          <Stat label="Words" value={readability.words} />
          <Stat label="Sentences" value={readability.sentences} />
          <Stat label="Syllables" value={readability.syllables} />
          <Stat label="Avg words / sentence" value={readability.sentences ? Math.round((readability.words / readability.sentences) * 10) / 10 : 0} />
          <div className="mt-2 pt-1 border-t border-border-default flex items-center gap-1 text-[10px] text-rmpg-400">
            <FileStack className="w-3 h-3" /> <span className="text-rmpg-100 tabular-nums">{pageEst.pages}</span> printed page{pageEst.pages === 1 ? '' : 's'} (est.)
          </div>
          <p className="text-[9px] text-rmpg-600 mt-2 leading-snug">Aim for 60–70 (plain English). Reports above grade 12 may be hard to read in court.</p>
        </div>
      )}

      {tab === 'style' && (
        <div>
          <div className="text-[10px] text-rmpg-400 mb-1">
            {issues.length === 0 ? 'No style issues found.' : `${issues.length} suggestion${issues.length === 1 ? '' : 's'}`}
          </div>
          <div className="space-y-1.5">
            {issues.map((iss, i) => (
              <div key={i} className="border border-border-default rounded-[2px] px-1.5 py-1">
                <div className={`text-[9px] uppercase font-semibold ${issueColor(iss.kind)}`}>{iss.detail}</div>
                <div className="text-[10px] text-rmpg-300 mt-0.5 line-clamp-3 leading-snug">{iss.sentence}</div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-rmpg-600 mt-2 leading-snug">Heuristic checks: prefer active voice ("I arrested" vs "was arrested"), keep sentences under ~30 words, and cut filler words.</p>
        </div>
      )}

      {tab === 'frequency' && (
        <div>
          <div className="text-[9px] text-rmpg-500 uppercase tracking-wide pb-1">Top words</div>
          {words.length === 0 && <div className="text-[10px] text-rmpg-600 italic">No content yet</div>}
          <div className="space-y-0.5 mb-2">
            {words.map((w) => (
              <div key={w.word} className="flex items-center gap-1.5">
                <span className="text-[10px] text-rmpg-300 w-24 truncate">{w.word}</span>
                <span className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                  <span className="block h-full bg-[#d4a017]/70" style={{ width: `${Math.min(100, (w.count / (words[0]?.count || 1)) * 100)}%` }} />
                </span>
                <span className="text-[10px] text-rmpg-500 tabular-nums w-5 text-right">{w.count}</span>
              </div>
            ))}
          </div>
          {phrases.length > 0 && (
            <>
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wide pb-1 pt-1 border-t border-border-default">Top phrases</div>
              <div className="space-y-0.5">
                {phrases.map((p) => (
                  <div key={p.word} className="flex items-center justify-between">
                    <span className="text-[10px] text-rmpg-300 truncate">{p.word}</span>
                    <span className="text-[10px] text-rmpg-500 tabular-nums">{p.count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'diff' && (
        <div className="flex flex-col min-h-0">
          <textarea
            value={prevText}
            onChange={(e) => setPrevText(e.target.value)}
            placeholder="Paste a previous version here to compare against the current document…"
            className="w-full h-20 bg-surface-base border border-border-default text-rmpg-200 text-[10px] rounded-[2px] p-1.5 focus:outline-none focus:border-[#d4a017]/50 resize-none mb-2"
          />
          {prevText && (
            <>
              <div className="flex items-center gap-2 text-[9px] mb-1">
                <span className="text-green-400">+{diffSummary.added} added</span>
                <span className="text-red-400">−{diffSummary.removed} removed</span>
                <span className="text-rmpg-500">{diffSummary.unchanged} same</span>
              </div>
              <div className="text-[10px] leading-relaxed bg-surface-base border border-border-default rounded-[2px] p-1.5 max-h-64 overflow-auto whitespace-pre-wrap">
                {diffOps.map((op, i) => (
                  <span key={i}
                    className={op.type === 'add' ? 'bg-green-900/40 text-green-300' : op.type === 'del' ? 'bg-red-900/40 text-red-300 line-through' : 'text-rmpg-300'}>
                    {op.text}
                  </span>
                ))}
              </div>
            </>
          )}
          {!prevText && <p className="text-[9px] text-rmpg-600 leading-snug">Word-level diff highlights additions (green) and deletions (red) against the pasted text.</p>}
        </div>
      )}
    </div>
  );
}
