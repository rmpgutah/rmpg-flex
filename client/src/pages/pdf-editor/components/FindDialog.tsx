import { useEffect, useRef, useState } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';

// Find-in-document search bar — searches the rendered text layer (PDF.js
// getTextContent results) for matches. Highlights matches in-place using
// a CSS class on the existing transparent text-layer spans.

interface Props {
  open: boolean;
  onClose: () => void;
  /** Highest visible page (so we know where to start searching forward). */
  currentPage: number;
  /** Called when the user navigates to a match — caller scrolls there. */
  onJumpTo: (page: number, matchIndex: number) => void;
}

export default function FindDialog({ open, onClose, currentPage, onJumpTo }: Props) {
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Search the rendered text-layer DOM whenever the query changes. We
  // re-scan all spans inside any element with class "pdf-text-span".
  useEffect(() => {
    if (!open) return;
    const allSpans = document.querySelectorAll<HTMLSpanElement>('.pdf-text-span');
    let count = 0;
    const q = query.trim().toLowerCase();
    allSpans.forEach((span) => {
      span.classList.remove('pdf-find-match', 'pdf-find-active');
      if (q && (span.textContent ?? '').toLowerCase().includes(q)) {
        span.classList.add('pdf-find-match');
        count++;
      }
    });
    setMatchCount(count);
    setActive(0);
  }, [query, open]);

  const navigate = (delta: 1 | -1) => {
    if (matchCount === 0) return;
    const next = (active + delta + matchCount) % matchCount;
    setActive(next);
    const matches = document.querySelectorAll<HTMLSpanElement>('.pdf-text-span.pdf-find-match');
    const target = matches.item(next);
    if (target) {
      document.querySelectorAll('.pdf-find-active').forEach(el => el.classList.remove('pdf-find-active'));
      target.classList.add('pdf-find-active');
      const pageEl = target.closest('[data-page-number]') as HTMLElement | null;
      const pageNum = pageEl ? parseInt(pageEl.dataset.pageNumber || '1', 10) : currentPage;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onJumpTo(pageNum, next);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed top-[120px] right-6 z-40 bg-[#141414] border border-[#222] rounded-[2px] p-2 shadow-lg w-[320px]">
      <div className="flex items-center gap-1.5">
        <Search className="w-3.5 h-3.5 text-rmpg-400" />
        <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(e.shiftKey ? -1 : 1);
            else if (e.key === 'Escape') onClose();
          }}
          placeholder="Find in document…"
          className="flex-1 bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]" />
        <span className="text-[10px] text-rmpg-500 min-w-[60px] text-right">
          {matchCount === 0 ? (query ? 'no match' : '') : `${active + 1} / ${matchCount}`}
        </span>
        <button type="button" onClick={() => navigate(-1)} disabled={matchCount === 0}
          className="p-1 text-rmpg-400 hover:text-white disabled:opacity-30" aria-label="Previous match"><ChevronUp className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={() => navigate(1)} disabled={matchCount === 0}
          className="p-1 text-rmpg-400 hover:text-white disabled:opacity-30" aria-label="Next match"><ChevronDown className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={onClose} className="p-1 text-rmpg-400 hover:text-white" aria-label="Close"><X className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}
