// Accept / reject logic for the suggestion (track-changes) mark.
//
// Walks the document for ranges carrying the `suggestion` mark and applies a
// resolution:
//   accept → insertions become normal text (mark removed); deletions are removed.
//   reject → insertions are removed; deletions become normal text (mark removed).
// Operates over ProseMirror positions so it survives any document structure.

import type { Editor } from '@tiptap/react';

interface SuggestRange { from: number; to: number; change: 'ins' | 'del' }

/** Collect all suggestion-marked ranges in document order. */
export function collectSuggestions(editor: Editor): SuggestRange[] {
  const markType = editor.schema.marks.suggestion;
  if (!markType) return [];
  const ranges: SuggestRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((mk) => mk.type === markType);
    if (mark) {
      ranges.push({
        from: pos,
        to: pos + node.nodeSize,
        change: mark.attrs.change === 'del' ? 'del' : 'ins',
      });
    }
  });
  return ranges;
}

export interface ResolveResult { insertions: number; deletions: number }

/** Count pending insertions/deletions (merging adjacent text nodes). */
export function countSuggestions(editor: Editor): ResolveResult {
  const ranges = collectSuggestions(editor);
  let insertions = 0, deletions = 0;
  let lastChange: string | null = null;
  for (const r of ranges) {
    if (r.change !== lastChange) {
      if (r.change === 'ins') insertions++; else deletions++;
    }
    lastChange = r.change;
  }
  return { insertions, deletions };
}

/** Accept (or reject) all suggestions. Works back-to-front so position offsets
 *  stay valid as ranges are deleted. */
export function resolveAllSuggestions(editor: Editor, mode: 'accept' | 'reject'): void {
  const markType = editor.schema.marks.suggestion;
  if (!markType) return;
  const ranges = collectSuggestions(editor).sort((a, b) => b.from - a.from);
  let chain = editor.chain().focus();
  for (const r of ranges) {
    const remove =
      (mode === 'accept' && r.change === 'del') ||
      (mode === 'reject' && r.change === 'ins');
    if (remove) {
      chain = chain.deleteRange({ from: r.from, to: r.to });
    } else {
      // Keep the text, drop the suggestion mark.
      chain = chain.setTextSelection({ from: r.from, to: r.to }).unsetMark('suggestion');
    }
  }
  chain.run();
}
