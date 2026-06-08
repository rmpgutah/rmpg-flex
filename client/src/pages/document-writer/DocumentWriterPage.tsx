import { useCallback, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import ImageExt from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import SuperscriptExt from '@tiptap/extension-superscript';
import SubscriptExt from '@tiptap/extension-subscript';
import { FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PanelTitleBar from '../../components/PanelTitleBar';
import WriterToolbar from './components/WriterToolbar';
import TemplateChooser from './components/TemplateChooser';
import { populateTemplate } from './templates';
import type { DocumentTemplate } from './types';

export default function DocumentWriterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<'choose' | 'edit'>('choose');
  const [title, setTitle] = useState('Untitled Document');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      ImageExt.configure({ inline: true, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Start typing...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      SuperscriptExt,
      SubscriptExt,
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[800px] p-0',
      },
    },
  });

  const handleTemplateSelect = useCallback((template: DocumentTemplate, values: Record<string, string>) => {
    if (!editor) return;
    const html = populateTemplate(template, values);
    editor.commands.setContent(html);
    setTitle(template.name === 'Blank Document' ? 'Untitled Document' : `${template.name} - ${values.case_number || new Date().toLocaleDateString()}`);
    setMode('edit');
  }, [editor]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const html = editor.getHTML();
      const fileName = `${title.replace(/[^a-zA-Z0-9\s-]/g, '')}.html`;
      const blob = new Blob([html], { type: 'text/html' });
      const formData = new FormData();
      formData.append('files', new File([blob], fileName, { type: 'text/html' }));
      const folderId = searchParams.get('folderId');
      if (folderId) formData.append('folder_id', folderId);

      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/uploads', { method: 'POST', headers, body: formData });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json().catch(() => null) as unknown;
      // /api/uploads returns a bare array of records; tolerate the legacy
      // `{ files: [...] }` envelope too.
      const rec: any = Array.isArray(data) ? data[0] : (data as any)?.files?.[0] ?? (data as any)?.file;
      const fileId = rec?.file_id ?? rec?.fileId ?? rec?.id;
      if (fileId) setDocumentId(fileId);
      setSavedNotice(`Saved to Documents as "${title}"`);
      setTimeout(() => setSavedNotice(null), 4000);
    } catch (err) {
      console.error('[document-writer] save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [editor, title, searchParams]);

  const handleExportPdf = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-9999px';
    printFrame.style.width = '816px';
    printFrame.style.height = '1056px';
    document.body.appendChild(printFrame);
    const doc = printFrame.contentDocument;
    if (!doc) { document.body.removeChild(printFrame); return; }
    doc.open();
    doc.write([
      '<!DOCTYPE html><html><head><title>',
      title,
      '</title><style>',
      '@page{size:letter;margin:1in}',
      'body{font-family:"Segoe UI",system-ui,sans-serif;font-size:12px;line-height:1.6;color:#000}',
      'h1{font-size:18px}h2{font-size:14px}h3{font-size:12px}',
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px}',
      'img{max-width:100%}',
      '</style></head><body>',
      html,
      '</body></html>',
    ].join(''));
    doc.close();
    setTimeout(() => {
      printFrame.contentWindow?.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 300);
  }, [editor, title]);

  const handlePrint = useCallback(() => {
    handleExportPdf();
  }, [handleExportPdf]);

  const handleInsertImage = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result as string }).run();
    };
    reader.readAsDataURL(file);
  }, [editor]);

  if (mode === 'choose') {
    return (
      <div className="p-3 h-[calc(100vh-140px)] overflow-auto">
        <TemplateChooser onSelect={handleTemplateSelect} />
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col h-[calc(100vh-140px)]">
      <PanelTitleBar title="DOCUMENT WRITER" icon={FileText} />

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      {savedNotice && (
        <div className="bg-green-900/20 border border-green-700/40 text-green-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>{savedNotice}</span>
          <button type="button" onClick={() => navigate('/documents')} className="ml-auto text-green-300 hover:text-white text-[10px]">
            Open Documents →
          </button>
        </div>
      )}

      <div className="mt-2">
        <WriterToolbar
          editor={editor}
          onSave={handleSave}
          onExportPdf={handleExportPdf}
          onPrint={handlePrint}
          onInsertImage={handleInsertImage}
          saving={saving}
          title={title}
          onTitleChange={setTitle}
        />
      </div>

      {/* Editor canvas — styled like a page */}
      <div className="flex-1 mt-3 overflow-auto bg-[#050505] border border-[#1a1a1a] rounded-[2px] flex justify-center">
        <div className="w-[816px] min-h-[1056px] bg-white my-6 shadow-2xl shadow-black/50"
          style={{ padding: '72px' }}>
          <EditorContent editor={editor} className="writer-content" />
        </div>
      </div>

      {/* Status bar */}
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-rmpg-600 px-1">
        <span>{editor?.storage.characterCount?.characters?.() ?? 0} characters</span>
        <span>{documentId ? `Saved • ID: ${documentId.slice(0, 8)}` : 'Unsaved'}</span>
        <span>{user?.full_name || user?.username || 'Unknown author'}</span>
      </div>
    </div>
  );
}
