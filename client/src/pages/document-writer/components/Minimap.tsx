import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Map as MapIcon, X } from 'lucide-react';

/** Document minimap — a scaled-down live thumbnail of the editor page with a
 *  draggable viewport indicator. Clicking (or dragging) on the thumbnail scrolls
 *  the real editor scroll container to the matching position.
 *
 *  The thumbnail is a *cloned node* of the live ProseMirror DOM (not an
 *  innerHTML injection) scaled down with a CSS transform, so it mirrors exactly
 *  what's on the page without re-parsing untrusted strings.
 *
 *  `scrollSelector` is a CSS selector for the scrollable editor container (the
 *  element whose scrollTop we drive). */
const THUMB_WIDTH = 150;

export default function Minimap({
  editor, scrollSelector, onClose,
}: { editor: Editor; scrollSelector: string; onClose: () => void }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [pageW, setPageW] = useState(816);
  const [scrollFrac, setScrollFrac] = useState(0);
  const [viewFrac, setViewFrac] = useState(0.2);
  const dragging = useRef(false);

  // Re-render the thumbnail whenever the document changes.
  useEffect(() => {
    const update = () => setVersion((v) => v + 1);
    editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor]);

  // Clone the live ProseMirror node into the thumbnail holder.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const pm = document.querySelector('.writer-content .ProseMirror') as HTMLElement | null;
    const pageEl = document.querySelector('.writer-page') as HTMLElement | null;
    if (pageEl) setPageW(pageEl.offsetWidth || 816);
    holder.replaceChildren();
    if (pm) {
      const clone = pm.cloneNode(true) as HTMLElement;
      clone.removeAttribute('contenteditable');
      clone.style.pointerEvents = 'none';
      holder.appendChild(clone);
    }
  }, [editor, version]);

  // Track the real scroll container's position → viewport indicator.
  useEffect(() => {
    const container = document.querySelector(scrollSelector) as HTMLElement | null;
    if (!container) return;
    const onScroll = () => {
      const max = container.scrollHeight - container.clientHeight;
      setScrollFrac(max > 0 ? container.scrollTop / max : 0);
      setViewFrac(container.scrollHeight > 0 ? Math.min(1, container.clientHeight / container.scrollHeight) : 0.2);
    };
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollSelector, version]);

  const scrollToFrac = (frac: number) => {
    const container = document.querySelector(scrollSelector) as HTMLElement | null;
    if (!container) return;
    const max = container.scrollHeight - container.clientHeight;
    container.scrollTo({ top: Math.max(0, Math.min(max, frac * max)), behavior: 'auto' });
  };

  const onMapPointer = (clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const frac = (clientY - rect.top) / rect.height;
    scrollToFrac(Math.max(0, Math.min(1, frac - viewFrac / 2)));
  };

  const scale = THUMB_WIDTH / pageW;

  return (
    <div className="w-[170px] shrink-0 bg-[#0d0d0d] border border-[#222] rounded-[2px] p-2 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide flex items-center gap-1">
          <MapIcon className="w-3 h-3" /> Minimap
        </span>
        <button type="button" onClick={onClose} aria-label="Close minimap" className="text-[10px] text-rmpg-500 hover:text-rmpg-200"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div
        className="relative flex-1 overflow-hidden bg-white rounded-[2px] cursor-pointer select-none"
        style={{ width: THUMB_WIDTH }}
        onMouseDown={(e) => { dragging.current = true; onMapPointer(e.clientY, e.currentTarget); }}
        onMouseMove={(e) => { if (dragging.current) onMapPointer(e.clientY, e.currentTarget); }}
        onMouseUp={() => { dragging.current = false; }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {/* Scaled-down clone of the live ProseMirror DOM (non-interactive). */}
        <div
          ref={holderRef}
          className="writer-content pointer-events-none origin-top-left"
          style={{ width: pageW, transform: `scale(${scale})`, color: '#111', padding: '16px' }}
        />
        {/* Viewport indicator. */}
        <div
          className="absolute left-0 right-0 bg-[#d4a017]/25 border-y border-[#d4a017]/60 pointer-events-none"
          style={{ top: `${scrollFrac * (1 - viewFrac) * 100}%`, height: `${viewFrac * 100}%` }}
        />
      </div>
      <p className="text-[9px] text-rmpg-600 mt-1.5 leading-snug">Click or drag to jump.</p>
    </div>
  );
}
