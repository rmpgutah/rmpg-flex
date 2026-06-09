import type { Editor } from '@tiptap/react';
import { collectHeadings } from '../docActions';

/** Document outline / navigation pane (features 184/194). Lists headings and
 *  jumps to them; also flags a broken heading hierarchy (e.g. H1 → H3). */
export default function OutlinePane({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const headings = collectHeadings(editor);

  const jump = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run();
    try {
      const dom = editor.view.domAtPos(pos + 1);
      const node = dom?.node as HTMLElement | undefined;
      (node?.nodeType === 1 ? node : node?.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch { /* noop */ }
  };

  // Heading-hierarchy validation: a jump of more than one level is a gap.
  let prevLevel = 0;
  return (
    <div className="w-40 sm:w-56 shrink-0 bg-[#0d0d0d] border border-[#222] rounded-[2px] p-2 overflow-auto">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide">Outline</span>
        <button type="button" onClick={onClose} className="text-[10px] text-rmpg-500 hover:text-rmpg-200">✕</button>
      </div>
      {headings.length === 0 && <div className="text-[10px] text-rmpg-600 italic">No headings yet</div>}
      {headings.map((h, i) => {
        const gap = prevLevel > 0 && h.level > prevLevel + 1;
        prevLevel = h.level;
        return (
          <button key={i} type="button" onClick={() => jump(h.pos)}
            title={gap ? 'Heading level skipped (accessibility)' : ''}
            className="block w-full text-left text-[11px] text-rmpg-300 hover:text-[#d4a017] py-0.5 truncate"
            style={{ paddingLeft: (h.level - 1) * 12 }}>
            {gap && <span className="text-amber-500" title="Skipped heading level">⚠ </span>}
            {h.text || <span className="italic opacity-50">(empty)</span>}
          </button>
        );
      })}
    </div>
  );
}
