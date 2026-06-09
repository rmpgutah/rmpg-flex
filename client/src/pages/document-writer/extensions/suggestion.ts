// Suggestion (track-changes) mark for the Document Writer.
//
// A lightweight "track changes" approximation: when suggestion mode is ON, text
// the user types/selects can be marked as an INSERTION (green underline) and
// selected text can be marked as a proposed DELETION (red strike). The reviewer
// then ACCEPTS (keep insertions, remove deletions) or REJECTS (remove insertion
// marks' text, keep deletion text). Stored as a mark so it survives saves.
//
// This is intentionally simpler than a full OT/CRDT track-changes engine — it's
// a single-author suggestion layer suitable for self-review before submitting a
// report. No external packages.

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestion: {
      markInsertion: () => ReturnType;
      markDeletion: () => ReturnType;
      clearSuggestion: () => ReturnType;
    };
  }
}

export const Suggestion = Mark.create({
  name: 'suggestion',
  inclusive: true,
  addAttributes() {
    return {
      change: {
        // 'ins' | 'del'
        default: 'ins',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-change') || 'ins',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-change': attrs.change || 'ins' }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-change]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const change = (HTMLAttributes as any)['data-change'] === 'del' ? 'del' : 'ins';
    return ['span', mergeAttributes(HTMLAttributes, { class: `doc-suggest doc-suggest-${change}` }), 0];
  },
  addCommands() {
    return {
      markInsertion: () => ({ commands }: any) => commands.setMark(this.name, { change: 'ins' }),
      markDeletion: () => ({ commands }: any) => commands.setMark(this.name, { change: 'del' }),
      clearSuggestion: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any;
  },
});

export default Suggestion;
