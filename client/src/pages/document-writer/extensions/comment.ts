// Comment mark (features 101–110). The mark only tags a text range with a
// commentId + highlight; the thread data (author, text, timestamp, replies,
// resolved) lives in page state keyed by that id, so threads can be rendered in a
// sidebar and resolved without touching the doc. No external packages.

import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: string) => ReturnType;
      unsetComment: (commentId?: string) => ReturnType;
    };
  }
}

export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs: Record<string, any>) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
      resolved: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-resolved') === 'true',
        renderHTML: (attrs: Record<string, any>) => (attrs.resolved ? { 'data-resolved': 'true' } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'doc-comment' }), 0];
  },
  addCommands() {
    return {
      setComment: (commentId: string) => ({ commands }: any) => commands.setMark(this.name, { commentId }),
      unsetComment: () => ({ commands }: any) => commands.unsetMark(this.name),
    } as any;
  },
});

export default Comment;
