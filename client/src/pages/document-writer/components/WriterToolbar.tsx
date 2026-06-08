import { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, List, ListOrdered, Table, Image, Undo2, Redo2,
  Type, Heading1, Heading2, Heading3, Minus, Quote, Code, Superscript,
  Subscript, Highlighter, RemoveFormatting, IndentIncrease, IndentDecrease,
  CheckSquare, Link2, Printer, Download, Save, FileText
} from 'lucide-react';

interface Props {
  editor: Editor | null;
  onSave: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
  onInsertImage: () => void;
  saving: boolean;
  title: string;
  onTitleChange: (title: string) => void;
}

function ToolBtn({ active, disabled, onClick, children, title }: {
  active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded-[2px] transition-colors ${
        active ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-[#1a1a1a]'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-[#222] mx-1" />;
}

export default function WriterToolbar({ editor, onSave, onExportPdf, onPrint, onInsertImage, saving, title, onTitleChange }: Props) {
  if (!editor) return null;

  const addTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-[2px] p-1.5">
      {/* Title bar */}
      <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-[#1a1a1a]">
        <FileText className="w-4 h-4 text-[#d4a017]" />
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Document"
          className="flex-1 bg-transparent border-none text-sm text-rmpg-100 font-semibold focus:outline-none placeholder-rmpg-600"
        />
        <button type="button" onClick={onSave} disabled={saving}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-[#d4a017]/10 border border-[#d4a017]/30 text-[#d4a017] rounded-[2px] hover:bg-[#d4a017]/20 disabled:opacity-50">
          <Save className="w-3 h-3" />{saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onExportPdf}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          <Download className="w-3 h-3" />PDF
        </button>
        <button type="button" onClick={onPrint}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          <Printer className="w-3 h-3" />Print
        </button>
      </div>

      {/* Formatting toolbar */}
      <div className="flex items-center flex-wrap gap-0.5">
        {/* History */}
        <ToolBtn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo2 className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        {/* Text style */}
        <ToolBtn title="Normal text" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>
          <Type className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        {/* Inline formatting */}
        <ToolBtn title="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
          <Superscript className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
          <Subscript className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Highlight" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Clear formatting" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
          <RemoveFormatting className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        {/* Alignment */}
        <ToolBtn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
          <AlignLeft className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
          <AlignCenter className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
          <AlignRight className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
          <AlignJustify className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        {/* Lists */}
        <ToolBtn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Task list" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <CheckSquare className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        {/* Insert */}
        <ToolBtn title="Insert table" onClick={addTable}>
          <Table className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Insert image" onClick={onInsertImage}>
          <Image className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Insert link" onClick={() => {
          const url = window.prompt('URL:');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}>
          <Link2 className="w-3.5 h-3.5" />
        </ToolBtn>
      </div>
    </div>
  );
}
