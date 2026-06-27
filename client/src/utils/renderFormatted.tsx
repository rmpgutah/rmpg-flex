import React from 'react';
import { computeListLines, tokenizeInline } from './noteFormatting';

// Inline-only render: split a line into styled runs. Shared by the dispatch
// note list and the document preview so the two can't drift.
export function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return tokenizeInline(text).map((t, i) => {
    const cls = [
      t.bold && 'font-bold',
      t.italic && 'italic',
      t.underline && 'underline',
      t.strike && 'line-through',
    ].filter(Boolean).join(' ');
    return cls
      ? <span key={`${keyBase}-${i}`} className={cls}>{t.text}</span>
      : t.text;
  });
}

// Block-aware render: inline marks for single-line text; a block of indented
// rows (bullets / outline numbers) when the text contains list lines.
export function renderFormattedText(text: string): React.ReactNode {
  if (!text) return text;
  const lines = computeListLines(text);
  const hasList = lines.some((l) => l.kind !== 'plain');
  if (!hasList) return renderInline(text, 'inl');
  return (
    <span className="block">
      {lines.map((l, idx) => (
        <span key={idx} className="flex items-start" style={{ paddingLeft: `${l.depth * 1.1}em` }}>
          {l.kind !== 'plain' && (
            <span className="inline-block shrink-0 text-rmpg-400 mr-1" style={{ minWidth: '1.4em' }}>
              {l.kind === 'ordered' ? `${l.marker}.` : '•'}
            </span>
          )}
          <span className="flex-1 min-w-0">{renderInline(l.content, `l${idx}`)}</span>
        </span>
      ))}
    </span>
  );
}
