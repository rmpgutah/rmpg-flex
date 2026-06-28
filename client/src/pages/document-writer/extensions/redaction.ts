// Redaction mark for the Document Writer.
//
// Unlike features/index.ts' redactSelection() — which DESTROYS the text and
// replaces it with █ blocks — this is a reversible mark: it keeps the underlying
// text but renders it as a solid black bar (text hidden) on screen and in
// print/PDF. Toggle on a selection to redact; toggle off to un-redact. The text
// survives round-trips so an authorized export could be produced separately.
//
// No external packages.

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    redaction: {
      setRedaction: () => ReturnType;
      unsetRedaction: () => ReturnType;
      toggleRedaction: () => ReturnType;
    };
  }
}

export const Redaction = Mark.create({
  name: 'redaction',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'span[data-redacted]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-redacted': 'true', class: 'doc-redacted' }), 0];
  },
  addCommands() {
    return {
      setRedaction: () => ({ commands }: any) => commands.setMark(this.name),
      unsetRedaction: () => ({ commands }: any) => commands.unsetMark(this.name),
      toggleRedaction: () => ({ commands }: any) => commands.toggleMark(this.name),
    } as any;
  },
});

export default Redaction;
