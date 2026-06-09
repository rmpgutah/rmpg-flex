import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import ImageExt from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import FontFamily from '@tiptap/extension-font-family';
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
import TextStyleExtras from './extensions/textStyleExtras';
import BlockStyle, { PageBreak, SectionBreak } from './extensions/customBlocks';
import { PAGE_SIZES, DEFAULT_DOC_SETTINGS, type DocumentTemplate, type DocSettings, type WriterTheme } from './types';
import './writer.css';

const THEME_KEY = 'rmpg_writer_theme';

/** Initial theme: explicit saved choice wins, else auto by clock (night = dark). */
function initialTheme(): WriterTheme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  const hr = new Date().getHours();
  return hr < 7 || hr >= 19 ? 'dark' : 'light';
}

export default function DocumentWriterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const author = user?.full_name || user?.username || 'Unknown author';
  const [mode, setMode] = useState<'choose' | 'edit'>('choose');
  const [title, setTitle] = useState('Untitled Document');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [theme, setTheme] = useState<WriterTheme>(initialTheme);
  const [docSettings, setDocSettings] = useState<DocSettings>(DEFAULT_DOC_SETTINGS);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      // StarterKit 3.x already bundles Link + Underline, so don't import those
      // separately (avoids duplicate-extension warnings).
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: true }),
      TableRow, TableCell, TableHeader,
      ImageExt.configure({ inline: true, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      FontFamily,
      Placeholder.configure({ placeholder: 'Start typing...' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      SuperscriptExt,
      SubscriptExt,
      TextStyleExtras,
      BlockStyle,
      PageBreak,
      SectionBreak,
    ],
    editorProps: { attributes: { class: 'focus:outline-none min-h-[900px]' } },
  });

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

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
    setErrorNotice(null);
    try {
      const html = editor.getHTML();
      const safeName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'Untitled Document';
      const fileName = `${safeName}.html`;
      const blob = new Blob([html], { type: 'text/html' });
      const formData = new FormData();
      formData.append('files', new File([blob], fileName, { type: 'text/html' }));
      const folderId = searchParams.get('folderId');
      if (folderId) formData.append('folder_id', folderId);

      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/uploads', { method: 'POST', headers, body: formData });
      if (!res.ok) {
        // Surface the real failure instead of silently staying "Unsaved".
        const detail = await res.json().catch(() => null) as any;
        throw new Error(detail?.error || `Save failed (HTTP ${res.status})`);
      }
      const data = await res.json().catch(() => null) as unknown;
      const rec: any = Array.isArray(data) ? data[0] : (data as any)?.files?.[0] ?? (data as any)?.file;
      const fileId = rec?.file_id ?? rec?.fileId ?? rec?.id;
      if (fileId) setDocumentId(fileId);
      setSavedNotice(`Saved to Documents as "${title}"`);
      setTimeout(() => setSavedNotice(null), 4000);
    } catch (err) {
      console.error('[document-writer] save failed:', err);
      setErrorNotice(err instanceof Error ? err.message : 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }, [editor, title, searchParams]);

  const handleExportPdf = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const { page, watermark, header, footer, columns } = docSettings;
    const dim = PAGE_SIZES[page.size];
    const cssSize = page.orientation === 'landscape' ? `${dim.css} landscape` : dim.css;
    const m = page.margins;
    const headerHtml = header.enabled
      ? `<div class="rh">${escapeHtml(header.text)}${header.showPageNumber ? '<span class="pn"></span>' : ''}</div>` : '';
    const footerParts = [
      footer.text ? escapeHtml(footer.text) : '',
      footer.showDate ? new Date().toLocaleDateString() : '',
      footer.showAuthor ? escapeHtml(author) : '',
    ].filter(Boolean).join(' • ');
    const footerHtml = footer.enabled ? `<div class="rf">${footerParts}</div>` : '';
    const watermarkHtml = watermark.text
      ? `<div class="wm" style="opacity:${watermark.opacity}">${escapeHtml(watermark.text)}</div>` : '';

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-9999px';
    printFrame.style.width = `${dim.width}px`;
    printFrame.style.height = `${dim.height}px`;
    document.body.appendChild(printFrame);
    const doc = printFrame.contentDocument;
    if (!doc) { document.body.removeChild(printFrame); return; }
    doc.open();
    // Print ALWAYS uses black text on white, regardless of the editor theme.
    doc.write([
      '<!DOCTYPE html><html><head><title>', escapeHtml(title), '</title><style>',
      `@page{size:${cssSize};margin:${m.top}px ${m.right}px ${m.bottom}px ${m.left}px;`,
      '@bottom-right{content:counter(page)}}',
      'body{font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.5;color:#000;background:#fff}',
      `.body-cols{column-count:${columns};column-gap:24px}`,
      'h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.25em}h4{font-size:1.1em}',
      'p{margin:0 0 0.5em}a{color:#000}',
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px}',
      'img{max-width:100%}blockquote{border-left:3px solid #000;padding-left:1em;font-style:italic}',
      'p.drop-cap::first-letter{float:left;font-size:3.4em;line-height:0.8;font-weight:700;padding-right:6px}',
      '.doc-page-break{break-after:page}.doc-section-break{break-after:column}',
      '.rh{position:fixed;top:0;left:0;right:0;font-size:9pt;border-bottom:1px solid #999;padding-bottom:3px;display:flex;justify-content:space-between}',
      '.rf{position:fixed;bottom:0;left:0;right:0;font-size:9pt;border-top:1px solid #999;padding-top:3px;text-align:center}',
      '.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;font-weight:800;transform:rotate(-32deg);color:#000;z-index:-1}',
      'span[data-field="page"]::after{content:counter(page)}',
      '</style></head><body>', watermarkHtml, headerHtml,
      `<div class="body-cols">`, html, '</div>', footerHtml,
      '</body></html>',
    ].join(''));
    doc.close();
    setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 300);
  }, [editor, title, author, docSettings]);

  const handleInsertImage = useCallback(() => imageInputRef.current?.click(), []);
  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => { editor.chain().focus().setImage({ src: reader.result as string }).run(); };
    reader.readAsDataURL(file);
  }, [editor]);

  const handleInsertBackgroundImage = useCallback(() => bgImageInputRef.current?.click(), []);
  const handleBgImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDocSettings((s) => ({ ...s, backgroundImage: reader.result as string }));
    reader.readAsDataURL(file);
  }, []);

  // Keyboard shortcut: Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && mode === 'edit') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, mode]);

  if (mode === 'choose') {
    return (
      <div className="p-3 h-[calc(100vh-140px)] overflow-auto">
        <TemplateChooser onSelect={handleTemplateSelect} />
      </div>
    );
  }

  // Page geometry + theme-driven colors.
  const dim = PAGE_SIZES[docSettings.page.size];
  const landscape = docSettings.page.orientation === 'landscape';
  const pageW = landscape ? dim.height : dim.width;
  const pageH = landscape ? dim.width : dim.height;
  const pageBg = theme === 'dark' ? '#1e1e1e' : docSettings.background;
  const textColor = theme === 'dark' ? '#e8e8e8' : '#111111';
  const m = docSettings.page.margins;

  const contentClasses = [
    'writer-content',
    docSettings.columns === 2 ? 'cols-2' : docSettings.columns === 3 ? 'cols-3' : '',
    docSettings.lineNumbers ? 'line-numbers' : '',
    docSettings.widowControl ? 'widow-control' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="p-3 flex flex-col h-[calc(100vh-140px)]">
      <PanelTitleBar title="DOCUMENT WRITER" icon={FileText} />

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <input ref={bgImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgImageFile} />

      {savedNotice && (
        <div className="bg-green-900/20 border border-green-700/40 text-green-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>{savedNotice}</span>
          <button type="button" onClick={() => navigate('/documents')} className="ml-auto text-green-300 hover:text-white text-[10px]">Open Documents →</button>
        </div>
      )}
      {errorNotice && (
        <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>Save failed: {errorNotice}</span>
          <button type="button" onClick={() => setErrorNotice(null)} className="ml-auto text-red-300 hover:text-white text-[10px]">Dismiss</button>
        </div>
      )}

      <div className="mt-2">
        <WriterToolbar
          editor={editor}
          docSettings={docSettings}
          setDocSettings={(updater) => setDocSettings(updater)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onSave={handleSave}
          onExportPdf={handleExportPdf}
          onPrint={handleExportPdf}
          onInsertImage={handleInsertImage}
          onInsertBackgroundImage={handleInsertBackgroundImage}
          saving={saving}
          title={title}
          author={author}
          onTitleChange={setTitle}
        />
      </div>

      {docSettings.showRuler && (
        <div className="mt-2 flex justify-center">
          <div className="writer-ruler" style={{ width: pageW }} />
        </div>
      )}

      {/* Editor canvas — a page sheet whose theme drives bg + base text color. */}
      <div className="flex-1 mt-3 overflow-auto bg-[#050505] border border-[#1a1a1a] rounded-[2px] flex justify-center">
        <div
          className={`writer-page my-6 shadow-2xl shadow-black/50 ${docSettings.pageBorder ? 'has-page-border' : ''}`}
          style={{
            width: pageW,
            minHeight: pageH,
            background: pageBg,
            color: textColor,
            paddingTop: m.top, paddingRight: m.right, paddingBottom: m.bottom, paddingLeft: m.left,
            backgroundImage: docSettings.backgroundImage ? `url(${docSettings.backgroundImage})` : undefined,
            backgroundSize: 'cover',
          }}
        >
          {docSettings.watermark.text && (
            <div className="doc-watermark" style={{ opacity: docSettings.watermark.opacity, color: textColor }}>
              {docSettings.watermark.text}
            </div>
          )}
          {docSettings.header.enabled && (
            <div className="doc-running-header">
              <span>{docSettings.header.text}</span>
              {docSettings.header.showPageNumber && <span>Page 1</span>}
            </div>
          )}
          <EditorContent editor={editor} className={contentClasses} />
          {docSettings.footer.enabled && (
            <div className="doc-running-footer">
              <span>{docSettings.footer.text}</span>
              <span>
                {[docSettings.footer.showDate ? new Date().toLocaleDateString() : '', docSettings.footer.showAuthor ? author : '']
                  .filter(Boolean).join(' • ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="mt-1.5 flex items-center justify-between text-[9px] text-rmpg-600 px-1">
        <span>{docSettings.page.size.toUpperCase()} • {docSettings.page.orientation} • {theme} mode</span>
        <span className={documentId ? 'text-green-500/70' : ''}>{documentId ? `Saved • ID: ${documentId.slice(0, 8)}` : 'Unsaved'}</span>
        <span>{author}</span>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
