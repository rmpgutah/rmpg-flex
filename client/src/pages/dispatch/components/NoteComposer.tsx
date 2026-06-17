import { useRef, useCallback } from 'react';
import { classifyLine, INDENT_UNIT } from '../../../utils/noteFormatting';

interface NoteComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;        // fired on Shift+Enter
  autoFocus?: boolean;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}

const INDENT = ' '.repeat(INDENT_UNIT);

export default function NoteComposer({
  value, onChange, onSubmit, autoFocus, rows = 2,
  placeholder = 'Add note...', maxLength = 4000,
}: NoteComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Apply a new value + caret position, restoring focus/selection next frame.
  const apply = useCallback((next: string, selStart: number, selEnd = selStart) => {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }, [onChange]);

  // Wrap the current selection (or insert an empty marker pair at the caret).
  const wrap = useCallback((marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e);
    if (sel) {
      apply(value.slice(0, s) + marker + sel + marker + value.slice(e), s + marker.length, e + marker.length);
    } else {
      apply(value.slice(0, s) + marker + marker + value.slice(s), s + marker.length);
    }
  }, [value, apply]);

  // Bounds of the line containing `pos`.
  const lineBounds = (pos: number) => {
    const start = value.lastIndexOf('\n', pos - 1) + 1;
    const nl = value.indexOf('\n', pos);
    const end = nl === -1 ? value.length : nl;
    return { start, end };
  };

  // Prefix the caret's line with a list marker.
  const prefixLine = useCallback((prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const { start } = lineBounds(el.selectionStart);
    apply(value.slice(0, start) + prefix + value.slice(start), el.selectionStart + prefix.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, apply]);

  const handleKeyDown = useCallback((ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = ev.currentTarget;
    const mod = ev.ctrlKey || ev.metaKey;

    if (mod && ev.key.toLowerCase() === 'b') { ev.preventDefault(); return wrap('**'); }
    if (mod && ev.key.toLowerCase() === 'i') { ev.preventDefault(); return wrap('*'); }
    if (mod && ev.key.toLowerCase() === 'u') { ev.preventDefault(); return wrap('__'); }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); return wrap('~~'); }

    if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); onSubmit?.(); return; }

    if (ev.key === 'Tab') {
      ev.preventDefault();
      const { start } = lineBounds(el.selectionStart);
      if (ev.shiftKey) {
        const lead = value.slice(start).match(/^ {1,2}/)?.[0] ?? '';
        if (lead) apply(value.slice(0, start) + value.slice(start + lead.length), Math.max(start, el.selectionStart - lead.length));
      } else {
        apply(value.slice(0, start) + INDENT + value.slice(start), el.selectionStart + INDENT.length);
      }
      return;
    }

    if (ev.key === 'Enter' && !ev.shiftKey) {
      const { start, end } = lineBounds(el.selectionStart);
      const cl = classifyLine(value.slice(start, end));
      if (cl.kind !== 'plain') {
        ev.preventDefault();
        const indent = ' '.repeat(cl.depth * INDENT_UNIT);
        if (!cl.content.trim()) {
          // Empty list item -> exit the list (drop this line).
          apply(value.slice(0, start) + value.slice(end), start);
        } else {
          const next = cl.kind === 'bullet' ? '- ' : '1. ';
          const ins = `\n${indent}${next}`;
          const s = el.selectionStart;
          apply(value.slice(0, s) + ins + value.slice(el.selectionEnd), s + ins.length);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, apply, wrap, onSubmit]);

  const btn = 'w-6 h-5 flex items-center justify-center text-[10px] text-rmpg-400 hover:text-rmpg-100 hover:bg-[#88888830] border border-rmpg-700 rounded-sm transition-all duration-100 active:bg-[#88888850]';

  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <button type="button" title="Bold (Ctrl+B)" className={`${btn} font-black`} onClick={() => wrap('**')}>B</button>
        <button type="button" title="Italic (Ctrl+I)" className={`${btn} italic font-semibold`} onClick={() => wrap('*')}>I</button>
        <button type="button" title="Underline (Ctrl+U)" className={`${btn} underline`} onClick={() => wrap('__')}>U</button>
        <button type="button" title="Strikeout (Ctrl+Shift+S)" className={`${btn} line-through`} onClick={() => wrap('~~')}>S</button>
        <span className="w-px h-3 bg-rmpg-700 mx-0.5" />
        <button type="button" title="Bullet list" className={btn} onClick={() => prefixLine('- ')}>&bull;</button>
        <button type="button" title="Numbered list" className={btn} onClick={() => prefixLine('1. ')}>1.</button>
        <span className="text-[8px] text-rmpg-500 ml-2 font-mono select-none">Tab to indent · Shift+Enter to submit</span>
      </div>
      <textarea
        ref={ref}
        className="input-dark w-full text-xs resize-none"
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
