import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Check, Trash2, CornerDownRight } from 'lucide-react';

export interface CommentReply { author: string; text: string; createdAt: string }
export interface DocComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  replies: CommentReply[];
}

/** Comments sidebar (features 101–110). Threads are stored in page state keyed by
 *  the comment mark's id; this renders/threads/resolves them and jumps to the
 *  marked text. */
export default function CommentsSidebar({
  editor, comments, setComments, author, onClose,
}: {
  editor: Editor;
  comments: DocComment[];
  setComments: (updater: (c: DocComment[]) => DocComment[]) => void;
  author: string;
  onClose: () => void;
}) {
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const jumpTo = (id: string) => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found >= 0) return false;
      if (node.marks?.some((m) => m.type.name === 'comment' && m.attrs.commentId === id)) found = pos;
      return undefined;
    });
    if (found >= 0) {
      editor.chain().focus().setTextSelection(found + 1).run();
      try {
        const dom = editor.view.domAtPos(found + 1);
        const el = dom?.node as HTMLElement | undefined;
        (el?.nodeType === 1 ? el : el?.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch { /* noop */ }
    }
  };

  const resolve = (id: string) => setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)));
  const remove = (id: string) => {
    setComments((cs) => cs.filter((c) => c.id !== id));
    // Strip the mark for this id from the doc.
    editor.state.doc.descendants((node, pos) => {
      if (node.marks?.some((m) => m.type.name === 'comment' && m.attrs.commentId === id)) {
        editor.chain().setTextSelection({ from: pos, to: pos + node.nodeSize }).unsetComment().run();
      }
      return undefined;
    });
  };
  const addReply = (id: string) => {
    if (!replyText.trim()) return;
    setComments((cs) => cs.map((c) => (c.id === id
      ? { ...c, replies: [...c.replies, { author, text: replyText, createdAt: new Date().toLocaleString() }] }
      : c)));
    setReplyText('');
    setReplyFor(null);
  };

  const active = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  return (
    <div className="w-48 sm:w-64 shrink-0 bg-surface-base border border-border-default rounded-[2px] p-2 overflow-auto space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wide">Comments ({active.length})</span>
        <button type="button" onClick={onClose} className="text-[10px] text-rmpg-500 hover:text-rmpg-200">✕</button>
      </div>
      {comments.length === 0 && <div className="text-[10px] text-rmpg-600 italic">Select text and add a comment.</div>}
      {[...active, ...resolved].map((c) => (
        <div key={c.id} className={`border rounded-[2px] p-1.5 text-[11px] ${c.resolved ? 'border-border-default opacity-50' : 'border-rmpg-700'}`}>
          <div className="flex items-center justify-between mb-0.5">
            <button type="button" onClick={() => jumpTo(c.id)} className="text-[#d4a017] font-medium hover:underline">{c.author}</button>
            <div className="flex items-center gap-1">
              <button type="button" title={c.resolved ? 'Reopen' : 'Resolve'} onClick={() => resolve(c.id)} className="text-rmpg-400 hover:text-green-400"><Check className="w-3 h-3" /></button>
              <button type="button" title="Delete" onClick={() => remove(c.id)} className="text-rmpg-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
          <div className="text-[9px] text-rmpg-600 mb-1">{c.createdAt}</div>
          <div className="text-rmpg-200">{c.text}</div>
          {c.replies.map((r, i) => (
            <div key={i} className="mt-1 pl-2 border-l border-border-default">
              <div className="text-[#d4a017]/80 text-[10px]">{r.author}</div>
              <div className="text-rmpg-300">{r.text}</div>
            </div>
          ))}
          {replyFor === c.id ? (
            <div className="mt-1 flex gap-1">
              <input autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addReply(c.id); }}
                placeholder="Reply…" className="flex-1 bg-surface-base border border-border-default text-[10px] text-rmpg-100 rounded-[2px] px-1.5 py-0.5 focus:outline-none" />
              <button type="button" onClick={() => addReply(c.id)} className="text-[10px] text-[#d4a017] px-1">Send</button>
            </div>
          ) : (
            <button type="button" onClick={() => { setReplyFor(c.id); setReplyText(''); }} className="mt-1 flex items-center gap-1 text-[10px] text-rmpg-500 hover:text-rmpg-300"><CornerDownRight className="w-3 h-3" />Reply</button>
          )}
        </div>
      ))}
    </div>
  );
}
