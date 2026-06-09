import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { SNIPPETS } from '../features/snippets';

/** Inline phrase autocomplete for the Document Writer.
 *
 * As the user types, this watches the word/phrase immediately before the caret
 * and, once it's ≥3 chars, suggests matching boilerplate phrases drawn from the
 * snippet library (Miranda, consent, DV phrasing, etc.). A small popover appears
 * at the caret; ↑/↓ navigate, Tab/Enter accepts (replacing the typed prefix with
 * the full phrase), Esc dismisses. Pure DOM/caret math — no extra packages.
 *
 * Enabled is controlled by the page so the user can toggle it off. */

interface Suggestion { label: string; text: string }

// Build a lean phrase index once: prefer the first sentence of each snippet so
// completions stay short and useful.
const PHRASE_INDEX: Suggestion[] = SNIPPETS.map((s) => {
  const firstSentence = (s.text.split(/(?<=[.!?])\s/)[0] || s.text).trim();
  return { label: s.label, text: firstSentence };
}).filter((s) => s.text.length > 8);

const MIN_PREFIX = 3;
const MAX_RESULTS = 6;

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
}

export default function Autocomplete({ editor, enabled }: { editor: Editor; enabled: boolean }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const prefixLen = useRef(0);

  // Recompute suggestions on every selection/content change.
  useEffect(() => {
    if (!enabled) { setItems([]); setPos(null); return; }
    const recompute = () => {
      const { state, view } = editor;
      const { from, empty } = state.selection;
      if (!empty) { setItems([]); setPos(null); return; }
      // Grab up to 40 chars of text before the caret within the current block.
      const blockStart = state.selection.$from.start();
      const before = state.doc.textBetween(Math.max(blockStart, from - 40), from, '\n');
      const m = before.match(/([A-Za-z][A-Za-z'’]*(?:\s+[A-Za-z][A-Za-z'’]*){0,3})$/);
      const prefix = (m?.[1] || '').trim();
      if (prefix.length < MIN_PREFIX) { setItems([]); setPos(null); return; }
      const lower = prefix.toLowerCase();
      const hits = PHRASE_INDEX
        .filter((s) => decode(s.text).toLowerCase().startsWith(lower) && decode(s.text).length > prefix.length)
        .slice(0, MAX_RESULTS);
      if (hits.length === 0) { setItems([]); setPos(null); return; }
      prefixLen.current = prefix.length;
      setItems(hits);
      setActive(0);
      // Position the popover just below the caret.
      try {
        const coords = view.coordsAtPos(from);
        const host = view.dom.closest('.writer-page')?.getBoundingClientRect();
        const editorRect = (view.dom as HTMLElement).getBoundingClientRect();
        const ref = host || editorRect;
        setPos({ left: coords.left - ref.left, top: coords.bottom - ref.top + 4 });
      } catch { setPos(null); }
    };
    editor.on('selectionUpdate', recompute);
    editor.on('update', recompute);
    return () => { editor.off('selectionUpdate', recompute); editor.off('update', recompute); };
  }, [editor, enabled]);

  // Keyboard handling while suggestions are visible.
  useEffect(() => {
    if (items.length === 0) return;
    const accept = (s: Suggestion) => {
      const { from } = editor.state.selection;
      const replaceFrom = from - prefixLen.current;
      editor.chain().focus()
        .insertContentAt({ from: replaceFrom, to: from }, decode(s.text))
        .run();
      setItems([]); setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
      else if (e.key === 'Tab' || (e.key === 'Enter' && items.length)) {
        // Only intercept Enter when a suggestion is highlighted intentionally.
        if (e.key === 'Tab') { e.preventDefault(); accept(items[active]); }
        else if (e.key === 'Enter') { e.preventDefault(); accept(items[active]); }
      } else if (e.key === 'Escape') { setItems([]); setPos(null); }
    };
    // Capture phase so we beat the editor's own Tab/Enter handling.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [items, active, editor]);

  if (!enabled || items.length === 0 || !pos) return null;

  const accept = (s: Suggestion) => {
    const { from } = editor.state.selection;
    const replaceFrom = from - prefixLen.current;
    editor.chain().focus().insertContentAt({ from: replaceFrom, to: from }, decode(s.text)).run();
    setItems([]); setPos(null);
  };

  return (
    <div
      className="absolute z-40 w-72 max-w-[80vw] bg-[#0d0d0d] border border-[#2e2e2e] rounded-[2px] shadow-2xl shadow-black/60 overflow-hidden"
      style={{ left: Math.max(0, pos.left), top: pos.top }}
    >
      <div className="text-[8px] uppercase tracking-wider text-rmpg-600 px-2 pt-1.5 pb-0.5">Phrase suggestions · Tab to accept</div>
      {items.map((s, i) => (
        <button key={s.label + i} type="button"
          onMouseDown={(e) => { e.preventDefault(); accept(s); }}
          onMouseEnter={() => setActive(i)}
          className={`block w-full text-left px-2 py-1 ${i === active ? 'bg-[#d4a017]/15' : 'hover:bg-[#141414]'}`}>
          <div className={`text-[10px] font-medium ${i === active ? 'text-[#d4a017]' : 'text-rmpg-200'}`}>{decode(s.label)}</div>
          <div className="text-[9px] text-rmpg-500 line-clamp-1">{decode(s.text)}</div>
        </button>
      ))}
    </div>
  );
}
