// ============================================================
// RMPG Flex — Rich Text Editor (TipTap)
// ============================================================
// Headless rich text editor for incident narratives, arrest
// reports, case notes, and supplemental reports. Supports
// collaborative editing via Yjs WebSocket provider.
// ============================================================

import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

// ── Types ─────────────────────────────────────────────────

export interface RichTextEditorProps {
  /** Initial HTML content */
  content?: string;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Called on every content change with HTML string */
  onChange?: (html: string) => void;
  /** Read-only mode */
  editable?: boolean;
  /** CSS class for the editor container */
  className?: string;
  /** Auto-focus on mount */
  autoFocus?: boolean;
}

// ── Component ─────────────────────────────────────────────

/**
 * Rich text editor for narrative writing.
 * Built on TipTap/ProseMirror with Spillman Flex dark theme.
 */
export function RichTextEditor({
  content = '',
  placeholder = 'Begin typing narrative...',
  onChange,
  editable = true,
  className = '',
  autoFocus = false,
}: RichTextEditorProps): React.ReactElement {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    editable,
    autofocus: autoFocus,
    onUpdate: ({ editor: e }) => {
      onChange?.(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[120px] p-3',
      },
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(editable);
    }
  }, [editable, editor]);

  if (!editor) return React.createElement('div', null, 'Loading editor...');

  return React.createElement('div', {
    className: `rich-text-editor border border-[#222] rounded-sm bg-[#0a0a0a] ${className}`,
  },
    // Toolbar
    editable && React.createElement('div', {
      className: 'flex items-center gap-1 px-2 py-1 border-b border-[#222] bg-[#141414]',
    },
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleBold().run(),
        active: editor.isActive('bold'),
        label: 'B',
        title: 'Bold (Ctrl+B)',
      }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleItalic().run(),
        active: editor.isActive('italic'),
        label: 'I',
        title: 'Italic (Ctrl+I)',
      }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleStrike().run(),
        active: editor.isActive('strike'),
        label: 'S',
        title: 'Strikethrough',
      }),
      React.createElement('div', { className: 'w-px h-4 bg-[#333] mx-1' }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleBulletList().run(),
        active: editor.isActive('bulletList'),
        label: '•',
        title: 'Bullet List',
      }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleOrderedList().run(),
        active: editor.isActive('orderedList'),
        label: '1.',
        title: 'Numbered List',
      }),
      React.createElement('div', { className: 'w-px h-4 bg-[#333] mx-1' }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        active: editor.isActive('heading', { level: 2 }),
        label: 'H2',
        title: 'Heading',
      }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().toggleBlockquote().run(),
        active: editor.isActive('blockquote'),
        label: '"',
        title: 'Quote',
      }),
      React.createElement(ToolbarButton, {
        onClick: () => editor.chain().focus().setHorizontalRule().run(),
        active: false,
        label: '—',
        title: 'Horizontal Rule',
      }),
    ),
    // Editor content
    React.createElement(EditorContent, { editor }),
  );
}

// ── Toolbar Button ────────────────────────────────────────

interface ToolbarButtonProps {
  onClick: () => void;
  active: boolean;
  label: string;
  title: string;
}

function ToolbarButton({ onClick, active, label, title }: ToolbarButtonProps): React.ReactElement {
  return React.createElement('button', {
    type: 'button',
    onClick,
    title,
    className: `px-2 py-0.5 text-xs font-mono rounded-sm transition-colors ${
      active
        ? 'bg-[#d4a017] text-black'
        : 'text-[#888] hover:text-white hover:bg-[#222]'
    }`,
    'aria-label': title,
  }, label);
}

/**
 * Get plain text from HTML content (for search indexing, summaries).
 */
export function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export default RichTextEditor;
