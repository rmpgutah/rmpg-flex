import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold, Italic, Underline as UnderlineIcon, Highlighter, Link2, MessageSquarePlus,
  CaseUpper, Eraser,
} from 'lucide-react';

/** A floating "bubble" toolbar that appears directly above a non-empty text
 *  selection with the most common quick actions (bold / italic / underline /
 *  highlight / link / comment / uppercase / clear). Uses TipTap's BubbleMenu so
 *  positioning + show/hide is handled by the editor. */
export default function SelectionToolbar({
  editor, onComment,
}: {
  editor: Editor;
  /** Called when the user clicks the comment button (page wires the comment flow). */
  onComment: () => void;
}) {
  const btn = (active: boolean) =>
    `p-1 rounded-[2px] transition-colors ${
      active ? 'bg-[#d4a017]/25 text-[#d4a017]' : 'text-rmpg-300 hover:text-rmpg-100 hover:bg-[#1a1a1a]'
    }`;

  const setLink = () => {
    const prev = editor.getAttributes('link')?.href as string | undefined;
    const url = window.prompt('Link URL:', prev || 'https://');
    if (url === null) return;
    if (url.trim() === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const uppercaseSel = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, ' ');
    editor.chain().focus().insertContentAt({ from, to }, text.toUpperCase()).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: ed, from, to }) => from !== to && ed.isEditable && !ed.isActive('image')}
    >
      <div className="flex items-center gap-0.5 bg-[#0d0d0d] border border-[#2e2e2e] rounded-[2px] shadow-2xl shadow-black/60 px-1 py-0.5">
        <button type="button" aria-label="Bold" title="Bold" className={btn(editor.isActive('bold'))}
          onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Italic" title="Italic" className={btn(editor.isActive('italic'))}
          onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Underline" title="Underline" className={btn(editor.isActive('underline'))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Highlight" title="Highlight" className={btn(editor.isActive('highlight'))}
          onClick={() => editor.chain().focus().toggleHighlight().run()}><Highlighter className="w-3.5 h-3.5" /></button>
        <div className="w-px h-4 bg-[#222] mx-0.5" />
        <button type="button" aria-label="Add link" title="Add / edit link" className={btn(editor.isActive('link'))}
          onClick={setLink}><Link2 className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Uppercase selection" title="UPPERCASE selection" className={btn(false)}
          onClick={uppercaseSel}><CaseUpper className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Comment on selection" title="Comment on selection" className={btn(false)}
          onClick={onComment}><MessageSquarePlus className="w-3.5 h-3.5" /></button>
        <button type="button" aria-label="Clear formatting" title="Clear formatting" className={btn(false)}
          onClick={() => editor.chain().focus().unsetAllMarks().run()}><Eraser className="w-3.5 h-3.5" /></button>
      </div>
    </BubbleMenu>
  );
}
