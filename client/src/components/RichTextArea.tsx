import { forwardRef, useRef, useImperativeHandle, KeyboardEvent, TextareaHTMLAttributes } from 'react';
import { Bold, Italic, Underline, Link as LinkIcon, List, ListOrdered } from 'lucide-react';
import IconButton from './IconButton';

// Drop-in <textarea> replacement with a markdown formatting toolbar.
//
// Storage convention (plain text — survives SQLite, audit log, jsPDF, exports):
//   **bold**            — wraps with double asterisks
//   *italic*            — wraps with single asterisks
//   <ins>text</ins>     — HTML semantic tag for underline (toolbar default)
//   __text__            — alternate underline syntax also accepted by renderer
//   [text](url)         — markdown link
//   - item              — bullet list (line-level)
//   1. item             — numbered list (line-level)
//
// Keyboard shortcuts: Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+U.
//
// API: identical to <textarea>. `onChange` receives a real ChangeEvent so generic
// form handlers (e.target.name / e.target.value patterns) work without changes —
// the toolbar mutates via the native value setter and dispatches a real input event.
//
// To render saved values back to the user, use renderMarkdown() / <MarkdownText>
// from client/src/utils/markdown.ts.

type RichTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Hide the toolbar (rare — useful for very tight inline contexts). */
  hideToolbar?: boolean;
};

const nativeSetter = typeof window !== 'undefined'
  ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  : undefined;

function dispatchValue(textarea: HTMLTextAreaElement, next: string) {
  // React tracks value via its own descriptor; bypass with the native setter
  // and fire a real input event so onChange handlers receive a normal event.
  nativeSetter?.call(textarea, next);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function applyWrap(textarea: HTMLTextAreaElement, prefix: string, suffix: string, placeholder: string) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end) || placeholder;
  const next = text.substring(0, start) + prefix + selected + suffix + text.substring(end);
  dispatchValue(textarea, next);
  requestAnimationFrame(() => {
    textarea.focus();
    const selStart = start + prefix.length;
    textarea.setSelectionRange(selStart, selStart + selected.length);
  });
}

function applyLinePrefix(textarea: HTMLTextAreaElement, prefix: string) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = text.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const block = text.substring(lineStart, lineEnd) || (prefix === '1. ' ? 'item' : 'item');
  const lines = block.split('\n');
  const numbered = prefix === '1. ';
  const transformed = lines.map((line, i) => (numbered ? `${i + 1}. ${line}` : `${prefix}${line}`)).join('\n');
  const next = text.substring(0, lineStart) + transformed + text.substring(lineEnd);
  dispatchValue(textarea, next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + transformed.length);
  });
}

const RichTextArea = forwardRef<HTMLTextAreaElement, RichTextAreaProps>(
  ({ hideToolbar, className, rows = 3, onKeyDown, disabled, ...rest }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const ta = innerRef.current;
        if (!ta) return;
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); applyWrap(ta, '**', '**', 'bold text'); return; }
        if (k === 'i') { e.preventDefault(); applyWrap(ta, '*', '*', 'italic text'); return; }
        if (k === 'u') { e.preventDefault(); applyWrap(ta, '<ins>', '</ins>', 'underlined'); return; }
      }
      onKeyDown?.(e);
    };

    const wrap = (p: string, s: string, ph: string) => () => innerRef.current && applyWrap(innerRef.current, p, s, ph);
    const linePrefix = (p: string) => () => innerRef.current && applyLinePrefix(innerRef.current, p);

    const btnCls = 'p-1 text-rmpg-400 hover:text-white hover:bg-rmpg-700/60 rounded-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-rmpg-400';

    return (
      <div className="flex flex-col">
        {!hideToolbar && (
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 border border-b-0 border-[#222222] bg-[#0d0d0d] rounded-t-[2px]"
            role="toolbar"
            aria-label="Text formatting"
          >
            <IconButton onClick={wrap('**', '**', 'bold text')} disabled={disabled} className={btnCls} aria-label="Bold (Ctrl+B)" title="Bold (Ctrl+B)"><Bold className="w-3.5 h-3.5" /></IconButton>
            <IconButton onClick={wrap('*', '*', 'italic text')} disabled={disabled} className={btnCls} aria-label="Italic (Ctrl+I)" title="Italic (Ctrl+I)"><Italic className="w-3.5 h-3.5" /></IconButton>
            <IconButton onClick={wrap('<ins>', '</ins>', 'underlined text')} disabled={disabled} className={btnCls} aria-label="Underline (Ctrl+U)" title="Underline (Ctrl+U)"><Underline className="w-3.5 h-3.5" /></IconButton>
            <div className="w-px h-4 bg-[#222222] mx-1" aria-hidden="true" />
            <IconButton onClick={wrap('[', '](https://)', 'link text')} disabled={disabled} className={btnCls} aria-label="Insert link" title="Insert link"><LinkIcon className="w-3.5 h-3.5" /></IconButton>
            <div className="w-px h-4 bg-[#222222] mx-1" aria-hidden="true" />
            <IconButton onClick={linePrefix('- ')} disabled={disabled} className={btnCls} aria-label="Bulleted list" title="Bulleted list"><List className="w-3.5 h-3.5" /></IconButton>
            <IconButton onClick={linePrefix('1. ')} disabled={disabled} className={btnCls} aria-label="Numbered list" title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></IconButton>
          </div>
        )}
        <textarea
          ref={innerRef}
          rows={rows}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          className={`textarea-dark ${hideToolbar ? '' : 'rounded-t-none'} ${className ?? ''}`}
          {...rest}
        />
      </div>
    );
  }
);

RichTextArea.displayName = 'RichTextArea';

export default RichTextArea;
