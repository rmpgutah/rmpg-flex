import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
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
import { FileText, ZoomIn, ZoomOut, X, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { apiFetch, uploadsUrl } from '../../hooks/useApi';
import PanelTitleBar from '../../components/PanelTitleBar';
import WriterToolbar from './components/WriterToolbar';
import TemplateChooser from './components/TemplateChooser';
import FindReplacePanel from './components/FindReplacePanel';
import OutlinePane from './components/OutlinePane';
import CommentsSidebar, { type DocComment } from './components/CommentsSidebar';
import StatusBar from './components/StatusBar';
import CommandPalette from './components/CommandPalette';
import FeaturesPanel from './components/FeaturesPanel';
import SnapshotsPanel from './components/SnapshotsPanel';
import AnalysisPanel from './components/AnalysisPanel';
import DocPropertiesDialog from './components/DocPropertiesDialog';
import ShortcutsHelp from './components/ShortcutsHelp';
import RecentDocsPanel from './components/RecentDocsPanel';
import MergePanel from './components/MergePanel';
import RefinersPanel from './components/RefinersPanel';
import ProofreadPanel from './components/ProofreadPanel';
import SectionsPanel from './components/SectionsPanel';
import TrackChangesPanel from './components/TrackChangesPanel';
import Minimap from './components/Minimap';
import Autocomplete from './components/Autocomplete';
import AppearanceDialog from './components/AppearanceDialog';
import SelectionToolbar from './components/SelectionToolbar';
import WordLimitBar from './components/WordLimitBar';
import OutlineReorder from './components/OutlineReorder';
import MacroRecorder from './components/MacroRecorder';
import {
  insertNumberedCaption, insertSpacer, PAGE_PRESETS, applyPagePreset,
  getSelectionExport, clearDocument, type CaptionKind,
} from './docFeatures';
import { captureFormat, applyFormat, type CapturedFormat } from './docActions';
import {
  insertOfficerSignatureBlock, buildStandaloneHtml, duplicateTitle,
  touchRecentDoc, type RecentDoc,
} from './docTools';
import { insertCsvTable, insertStatuteReference, transformSelection, type CaseTransform } from './analysis';
import { ReadAloud, textToRead, ttsSupported } from './tts';
import { populateTemplate } from './templates';
import TextStyleExtras from './extensions/textStyleExtras';
import BlockStyle, { PageBreak, SectionBreak } from './extensions/customBlocks';
import TableFormatting from './extensions/tableFormatting';
import FindReplace from './extensions/findReplace';
import ListStyles from './extensions/listStyles';
import { Embed, Audio } from './extensions/mediaNodes';
import Comment from './extensions/comment';
import Redaction from './extensions/redaction';
import Suggestion from './extensions/suggestion';
import { loadAppearance, saveAppearance, applyAppearance, type EditorAppearance } from './appearance';
import ConfirmDialog from '../../components/ConfirmDialog';
import { htmlToMarkdown, htmlToPlainText, htmlToRtf, downloadFile, copyRich, copyText } from './exporters';
import { htmlToDocxBlob } from './docxExport';
import { writeDraft, readDraft, clearDraft, saveSnapshot } from './autosave';
import { PAGE_SIZES, DEFAULT_DOC_SETTINGS, type DocumentTemplate, type DocSettings, type WriterTheme } from './types';
import './writer.css';

const THEME_KEY = 'rmpg_writer_theme';
type ViewMode = 'normal' | 'reading' | 'fullscreen' | 'focus';

function initialTheme(): WriterTheme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  const hr = new Date().getHours();
  return hr < 7 || hr >= 19 ? 'dark' : 'light';
}

export default function DocumentWriterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
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
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null);
  const [showOutline, setShowOutline] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ title: string; html: string } | null>(null);
  const [language, setLanguage] = useState('en');
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

  // Ctrl+/ (or Cmd+/) opens the command palette. Captured globally so it works
  // regardless of where focus sits in the editor surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [readingAloud, setReadingAloud] = useState(false);
  const [brush, setBrush] = useState<CapturedFormat | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [clearDocOpen, setClearDocOpen] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const [recentTick, setRecentTick] = useState(0); // force RecentDocsPanel re-read after delete
  const [serverSaveState, setServerSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // New feature state (this wave): mail-merge, proofread, sections, track
  // changes, minimap, autocomplete, appearance.
  const [showMerge, setShowMerge] = useState(false);
  const [showProofread, setShowProofread] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showTrackChanges, setShowTrackChanges] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [suggestMode, setSuggestMode] = useState(false);
  const [autocompleteOn, setAutocompleteOn] = useState(() => localStorage.getItem('rmpg_writer_autocomplete') !== 'off');
  const [appearance, setAppearance] = useState<EditorAppearance>(loadAppearance);
  const [showRefiners, setShowRefiners] = useState(false);
  // Final wave: word-limit indicator, section reorder, macro recorder.
  const [showReorder, setShowReorder] = useState(false);
  const [showMacro, setShowMacro] = useState(false);
  const [wordLimitOn, setWordLimitOn] = useState(false);
  const [wordLimitMode, setWordLimitMode] = useState<'words' | 'characters'>(() =>
    (localStorage.getItem('rmpg_writer_limit_mode') as 'words' | 'characters') || 'words');
  const [wordLimit, setWordLimit] = useState<number>(() => {
    const n = Number(localStorage.getItem('rmpg_writer_limit_value'));
    return Number.isFinite(n) && n > 0 ? n : 500;
  });
  const pageRef = useRef<HTMLDivElement>(null);
  const documentIdRef = useRef<string | null>(null);
  // Mirror of docSettings so the debounced autosave can read current page
  // geometry/properties without re-subscribing on every settings change.
  const docSettingsRef = useRef<DocSettings>(DEFAULT_DOC_SETTINGS);
  const recentIdRef = useRef<string>(`doc-${new Date().toISOString()}`);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const readAloudRef = useRef<ReadAloud | null>(null);
  if (!readAloudRef.current) readAloudRef.current = new ReadAloud(setReadingAloud);

  const editor = useEditor({
    extensions: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (StarterKit as any).configure({ heading: { levels: [1, 2, 3, 4] } }),
      Table.configure({ resizable: true }),
      TableRow, TableCell, TableHeader, TableFormatting,
      ImageExt.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle, Color, Highlight.configure({ multicolor: true }), FontFamily,
      Placeholder.configure({ placeholder: 'Start typing...' }),
      TaskList, TaskItem.configure({ nested: true }),
      SuperscriptExt, SubscriptExt,
      TextStyleExtras, BlockStyle, PageBreak, SectionBreak,
      FindReplace, ListStyles, Embed, Audio, Comment, Redaction, Suggestion,
    ],
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[900px]',
        spellcheck: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document editor',
      },
    },
  });

  const toggleTheme = useCallback(() => {
    setTheme((t) => { const next = t === 'dark' ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, next); return next; });
  }, []);

  // Admin-configurable letterhead (Admin → Settings → documents). Fetched once;
  // failure just means templates use the built-in default header.
  const headerCfgRef = useRef<{ org_name?: string; tagline?: string; address?: string } | null>(null);
  useEffect(() => {
    apiFetch<Record<string, unknown>>('/admin/settings/values')
      .then((v) => {
        if (!v) return;
        const pick = (k: string) => (typeof v[k] === 'string' || typeof v[k] === 'number') ? String(v[k]) : undefined;
        headerCfgRef.current = {
          org_name: pick('doc_header_org_name'),
          tagline: pick('doc_header_tagline'),
          address: pick('doc_header_address'),
        };
      })
      .catch(() => { /* default header */ });
  }, []);

  const handleTemplateSelect = useCallback((template: DocumentTemplate, values: Record<string, string>) => {
    if (!editor) return;
    editor.commands.setContent(populateTemplate(template, values, headerCfgRef.current));
    setTitle(template.name === 'Blank Document' ? 'Untitled Document' : `${template.name} - ${values.case_number || new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`);
    setMode('edit');
  }, [editor]);

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    setErrorNotice(null);
    try {
      const safeName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'Untitled Document';
      // Persist a real, editable Word document (.docx) — Word/Pages/Docs all
      // open it — instead of a raw .html file. Edit round-trips still come from
      // the local autosave/JSON snapshot, so the Documents copy is the writable
      // deliverable.
      const blob = htmlToDocxBlob(editor.getHTML(), docSettings.page, {
        title: docSettings.properties.title || title,
        author,
      });
      const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const formData = new FormData();
      formData.append('files', new File([blob], `${safeName}.docx`, { type: docxType }));
      const folderId = searchParams.get('folderId');
      if (folderId) formData.append('folder_id', folderId);
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(uploadsUrl(), { method: 'POST', headers, body: formData });
      if (!res.ok) {
        const detail = await res.json().catch(() => null) as any;
        throw new Error(detail?.error || `Save failed (HTTP ${res.status})`);
      }
      const data = await res.json().catch(() => null) as unknown;
      const rec: any = Array.isArray(data) ? data[0] : (data as any)?.files?.[0] ?? (data as any)?.file;
      const fileId = rec?.file_id ?? rec?.fileId ?? rec?.id;
      if (fileId) setDocumentId(fileId);
      // The work is now persisted to Documents — drop the local autosave draft
      // so the next visit doesn't show a "Recovered an unsaved draft" banner for
      // content that was actually saved.
      clearDraft();
      setSavedNotice(`Saved to Documents as "${title}"`);
      setTimeout(() => setSavedNotice(null), 4000);
    } catch (err) {
      console.error('[document-writer] save failed:', err);
      setErrorNotice(err instanceof Error ? err.message : 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }, [editor, title, author, docSettings.page, docSettings.properties.title, searchParams]);

  const handleExportPdf = useCallback(() => {
    if (!editor) return;
    const html = editor.getHTML();
    const { page, watermark, header, footer, columns } = docSettings;
    const dim = PAGE_SIZES[page.size];
    const cssSize = page.orientation === 'landscape' ? `${dim.css} landscape` : dim.css;
    const m = page.margins;
    const headerHtml = header.enabled ? `<div class="rh">${escapeHtml(header.text)}${header.showPageNumber ? '<span class="pn"></span>' : ''}</div>` : '';
    const footerParts = [footer.text ? escapeHtml(footer.text) : '', footer.showDate ? new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '', footer.showAuthor ? escapeHtml(author) : ''].filter(Boolean).join(' • ');
    const footerHtml = footer.enabled ? `<div class="rf">${footerParts}</div>` : '';
    const watermarkHtml = watermark.text ? `<div class="wm" style="opacity:${watermark.opacity}">${escapeHtml(watermark.text)}</div>` : '';
    const letterheadHtml = docSettings.letterhead
      ? `<div class="rlh"><div class="rlh-name">ROCKY MOUNTAIN PROTECTIVE GROUP</div><div class="rlh-sub">Law Enforcement &amp; Private Security Services — Salt Lake City, Utah</div></div>`
      : '';
    const borderCss = docSettings.pageBorder
      ? ({ thin: '@page{border:1px solid #000}', thick: '@page{border:3px solid #000}', double: '@page{border:4px double #000}', gold: '@page{border:3px solid #d4a017}' }[docSettings.pageBorderStyle || 'thin'])
      : '';
    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = `position:fixed;left:-9999px;width:${dim.width}px;height:${dim.height}px`;
    document.body.appendChild(printFrame);
    const doc = printFrame.contentDocument;
    if (!doc) { document.body.removeChild(printFrame); return; }
    doc.open();
    const p = docSettings.properties;
    const metaTags = [
      p.author ? `<meta name="author" content="${escapeHtml(p.author)}">` : '',
      p.subject ? `<meta name="subject" content="${escapeHtml(p.subject)}">` : '',
      p.keywords ? `<meta name="keywords" content="${escapeHtml(p.keywords)}">` : '',
    ].join('');
    doc.write([
      '<!DOCTYPE html><html lang="', language, '"><head><title>', escapeHtml(p.title || title), '</title>', metaTags, '<style>',
      `@page{size:${cssSize};margin:${m.top}px ${m.right}px ${m.bottom}px ${m.left}px;@bottom-right{content:counter(page)}}`,
      borderCss,
      'body{font-family:"Times New Roman",Times,serif;font-size:12pt;line-height:1.5;color:#000;background:#fff}',
      '.rlh{text-align:center;border-bottom:2px solid #d4a017;padding-bottom:6px;margin-bottom:14px}',
      '.rlh-name{font-size:15pt;font-weight:700;letter-spacing:0.03em}.rlh-sub{font-size:9pt;color:#444}',
      `.body-cols{column-count:${columns};column-gap:24px}`,
      'h1{font-size:1.9em}h2{font-size:1.5em}h3{font-size:1.25em}h4{font-size:1.1em}p{margin:0 0 0.5em}a{color:#000}',
      // table-layout:fixed + cell overflow:hidden stop multi-column rows (the
      // signature block's unbreakable underscore "line" especially) from
      // overflowing the page — they divide the width evenly and clip instead.
      'table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #333;padding:6px;overflow:hidden}img{max-width:100%}',
      'blockquote{border-left:3px solid #000;padding-left:1em;font-style:italic}',
      'p.drop-cap::first-letter{float:left;font-size:3.4em;line-height:0.8;font-weight:700;padding-right:6px}',
      '.doc-page-break{break-after:page}.doc-section-break{break-after:column}',
      '.rh{position:fixed;top:0;left:0;right:0;font-size:9pt;border-bottom:1px solid #999;padding-bottom:3px;display:flex;justify-content:space-between}',
      '.rf{position:fixed;bottom:0;left:0;right:0;font-size:9pt;border-top:1px solid #999;padding-top:3px;text-align:center}',
      '.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;font-weight:800;transform:rotate(-32deg);color:#000;z-index:-1}',
      'span[data-field="page"]::after{content:counter(page)}.doc-comment{background:none}',
      '.doc-caption{font-size:0.85em;text-align:center;margin:4px 0 12px}.doc-caption strong{font-weight:700}',
      '.doc-spacer{display:block;outline:none}',
      '</style></head><body>', watermarkHtml, headerHtml, letterheadHtml, '<div class="body-cols">', html, '</div>', footerHtml, '</body></html>',
    ].join(''));
    doc.close();
    // Always schedule iframe removal, even if focus()/print() throws (popup
    // blockers / sandboxed contexts) — otherwise each export leaks a hidden
    // off-screen iframe into the DOM.
    setTimeout(() => {
      try { printFrame.contentWindow?.focus(); printFrame.contentWindow?.print(); }
      catch (err) { console.warn('[document-writer] print failed:', err); }
      finally { setTimeout(() => { try { document.body.removeChild(printFrame); } catch { /* already gone */ } }, 1000); }
    }, 300);
  }, [editor, title, author, docSettings, language]);

  const handleExport = useCallback((format: 'md' | 'txt' | 'rtf' | 'html') => {
    if (!editor) return;
    const html = editor.getHTML();
    const safe = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'document';
    if (format === 'md') downloadFile(`${safe}.md`, htmlToMarkdown(html), 'text/markdown');
    else if (format === 'txt') downloadFile(`${safe}.txt`, htmlToPlainText(html), 'text/plain');
    else if (format === 'rtf') downloadFile(`${safe}.rtf`, htmlToRtf(html), 'application/rtf');
    else downloadFile(`${safe}.html`, html, 'text/html');
  }, [editor, title]);

  // Download the document as a real, editable Word (.docx) file — opens in
  // Word, Pages, Google Docs, and LibreOffice. Carries the current page size +
  // margins into the file's section properties.
  const handleExportDocx = useCallback(() => {
    if (!editor) return;
    const safe = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'document';
    const blob = htmlToDocxBlob(editor.getHTML(), docSettings.page, {
      title: docSettings.properties.title || title,
      author,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${safe}.docx`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [editor, title, author, docSettings.page, docSettings.properties.title]);

  const handleEmailDoc = useCallback(() => {
    if (!editor) return;
    const body = encodeURIComponent(htmlToPlainText(editor.getHTML()).slice(0, 1500));
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${body}`;
  }, [editor, title]);

  const handleInsertImage = useCallback(() => imageInputRef.current?.click(), []);
  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => { editor.chain().focus().setImage({ src: reader.result as string }).run(); };
    reader.readAsDataURL(file);
  }, [editor]);
  const handleInsertBackgroundImage = useCallback(() => bgImageInputRef.current?.click(), []);
  const handleBgImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDocSettings((s) => ({ ...s, backgroundImage: reader.result as string }));
    reader.readAsDataURL(file);
  }, []);

  const handleAddComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) { setErrorNotice('Select some text first to comment on it.'); setTimeout(() => setErrorNotice(null), 3000); return; }
    const text = window.prompt('Comment:');
    if (!text) return;
    const id = `c-${new Date().toISOString()}-${comments.length}`;
    editor.chain().focus().setComment(id).run();
    setComments((cs) => [...cs, { id, author, text, createdAt: new Date().toLocaleString(), resolved: false, replies: [] }]);
    setShowComments(true);
  }, [editor, author, comments.length]);

  const handlePastePlain = useCallback(async () => {
    if (!editor) return;
    try { const t = await navigator.clipboard.readText(); editor.chain().focus().insertContent(escapeHtml(t).replace(/\n/g, '<br>')).run(); }
    catch { setErrorNotice('Clipboard read blocked — use Ctrl+Shift+V.'); setTimeout(() => setErrorNotice(null), 3000); }
  }, [editor]);
  const handleCopyAs = useCallback(async (format: 'plain' | 'html' | 'md') => {
    if (!editor) return;
    const html = editor.getHTML();
    if (format === 'html') await copyRich(html);
    else if (format === 'md') await copyText(htmlToMarkdown(html));
    else await copyText(htmlToPlainText(html));
  }, [editor]);

  const handleInsertEmbed = useCallback((kind: 'video' | 'audio' | 'iframe') => {
    if (!editor) return;
    const url = window.prompt(kind === 'audio' ? 'Audio URL:' : kind === 'video' ? 'Video URL (YouTube/Vimeo):' : 'Embed URL:');
    if (!url) return;
    if (kind === 'audio') editor.chain().focus().setAudio(url).run();
    else editor.chain().focus().setEmbed(url).run();
  }, [editor]);

  const handleSnapshot = useCallback(() => {
    if (!editor) return;
    const name = window.prompt('Snapshot name:', `${title} — ${new Date().toLocaleString()}`);
    if (name) saveSnapshot(name, title, editor.getHTML());
  }, [editor, title]);

  const flashNotice = useCallback((msg: string, ms = 3000) => {
    setSavedNotice(msg); setTimeout(() => setSavedNotice(null), ms);
  }, []);
  const flashError = useCallback((msg: string, ms = 3000) => {
    setErrorNotice(msg); setTimeout(() => setErrorNotice(null), ms);
  }, []);

  // Keep a ref of the current server document id so the debounced autosave
  // effect can read it without resetting on every id change.
  useEffect(() => { documentIdRef.current = documentId; }, [documentId]);
  useEffect(() => { docSettingsRef.current = docSettings; }, [docSettings]);

  // Insert an officer signature block auto-filled from the logged-in user
  // (name / badge / rank / department + today's date).
  const handleOfficerSignature = useCallback(() => {
    if (!editor) return;
    insertOfficerSignatureBlock(editor, {
      name: author,
      badge: user?.badge_number,
      rank: user?.rank,
      department: user?.department,
    });
  }, [editor, author, user]);

  // Export a complete, self-contained styled HTML file (distinct from the raw
  // editor-fragment HTML export).
  const handleExportStandaloneHtml = useCallback(() => {
    if (!editor) return;
    const html = buildStandaloneHtml({
      title: docSettings.properties.title || title,
      bodyHtml: editor.getHTML(),
      author,
      letterhead: docSettings.letterhead,
      margins: docSettings.page.margins,
    });
    const safe = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'document';
    downloadFile(`${safe}.html`, html, 'text/html');
  }, [editor, title, author, docSettings.properties.title, docSettings.letterhead, docSettings.page.margins]);

  // "New from current" — duplicate the document into a fresh, unsaved copy.
  const handleDuplicate = useCallback(() => {
    if (!editor) return;
    setTitle((t) => duplicateTitle(t));
    setDocumentId(null);
    recentIdRef.current = `doc-${new Date().toISOString()}`;
    flashNotice('Duplicated — this is now a new, unsaved copy. Save to store it separately.', 4000);
  }, [editor, flashNotice]);

  // Manual "save draft now" (local autosave) with an immediate indicator.
  const handleSaveDraftNow = useCallback(() => {
    if (!editor) return;
    const at = writeDraft(title, editor.getHTML());
    if (at) { setAutoSavedAt(at); flashNotice('Draft saved locally.'); }
    else flashError('Could not save the local draft (storage full?).');
  }, [editor, title, flashNotice, flashError]);

  // Open a recent document back into the editor.
  const handleOpenRecent = useCallback((doc: RecentDoc) => {
    if (!editor) return;
    editor.commands.setContent(doc.html);
    setTitle(doc.title);
    setDocumentId(doc.documentId ?? null);
    recentIdRef.current = doc.id;
    setShowRecent(false);
    flashNotice(`Opened "${doc.title}".`);
  }, [editor, flashNotice]);

  // Formatting brush: capture marks from the current selection, then apply them
  // to the next selection (a real format painter, not a CSS hack).
  const handleBrush = useCallback(() => {
    if (!editor) return;
    if (brush) {
      const ok = applyFormat(editor, brush);
      if (!ok) { flashError('Select the text to paint the format onto, then click the brush.'); return; }
      setBrush(null);
      return;
    }
    const captured = captureFormat(editor);
    if (!captured) { flashError('Place the cursor in (or select) formatted text first, then click the brush.'); return; }
    setBrush(captured);
    flashNotice('Format captured — select target text and click the brush again to apply.', 5000);
  }, [editor, brush, flashError, flashNotice]);

  // Case transforms on the selection (UPPER / lower / Title / Sentence).
  const handleTransform = useCallback((mode: CaseTransform) => {
    if (!editor) return;
    if (!transformSelection(editor, mode)) flashError('Select some text first.');
  }, [editor, flashError]);

  // Insert a table parsed from pasted CSV / TSV.
  const handleInsertCsv = useCallback(() => {
    if (!editor) return;
    const csv = window.prompt('Paste CSV or tab-separated rows (first row becomes the header):');
    if (!csv || !csv.trim()) return;
    const res = insertCsvTable(editor, csv, true);
    if (res) flashNotice(`Inserted a ${res.rows}×${res.cols} table from CSV.`);
    else flashError('Could not parse that as CSV.');
  }, [editor, flashNotice, flashError]);

  // Insert a formatted Utah Code statute citation.
  const handleInsertStatute = useCallback(() => {
    if (!editor) return;
    const section = window.prompt('Utah Code section (e.g. 76-6-206 or 41-6a-502):');
    if (!section || !section.trim()) return;
    const label = window.prompt('Optional short label (e.g. Criminal Trespass) — leave blank to skip:') || undefined;
    insertStatuteReference(editor, section, label && label.trim() ? label.trim() : undefined);
  }, [editor]);

  // Read aloud (TTS): toggles between speaking the selection/document and stop.
  const handleReadAloud = useCallback(() => {
    if (!editor) return;
    const ra = readAloudRef.current!;
    if (ra.speaking) { ra.stop(); return; }
    if (!ttsSupported()) { setErrorNotice('Read-aloud is not supported in this browser.'); setTimeout(() => setErrorNotice(null), 3000); return; }
    const text = textToRead(editor);
    if (!text) { setErrorNotice('Nothing to read.'); setTimeout(() => setErrorNotice(null), 3000); return; }
    ra.speak(text);
  }, [editor]);

  // Redact the current selection (reversible black-bar mark, distinct from the
  // destructive █-block redaction tool in the Tools panel).
  const handleToggleRedaction = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) { flashError('Select the text to redact (or un-redact) first.'); return; }
    editor.chain().focus().toggleRedaction().run();
  }, [editor, flashError]);

  // Toggle suggestion (track-changes) mode. While on, typed text is wrapped in
  // the insertion mark so it shows as a tracked change.
  const handleToggleSuggestMode = useCallback(() => {
    setSuggestMode((on) => {
      const next = !on;
      if (editor) {
        if (next) editor.chain().focus().setMark('suggestion', { change: 'ins' }).run();
        else editor.chain().focus().unsetMark('suggestion').run();
      }
      return next;
    });
  }, [editor]);

  // Apply + persist editor appearance whenever it changes (or the page mounts).
  const handleAppearanceChange = useCallback((next: EditorAppearance) => {
    setAppearance(next);
    saveAppearance(next);
    applyAppearance(pageRef.current, next);
  }, []);

  // Toggle inline phrase autocomplete (persisted).
  const handleToggleAutocomplete = useCallback(() => {
    setAutocompleteOn((on) => {
      const next = !on;
      localStorage.setItem('rmpg_writer_autocomplete', next ? 'on' : 'off');
      flashNotice(`Phrase autocomplete ${next ? 'on' : 'off'}.`);
      return next;
    });
  }, [flashNotice]);

  // ── Final-wave handlers ───────────────────────────────────────────────────

  // Insert an auto-numbered caption (Figure 1 / Table 2 / Exhibit A…).
  const handleInsertCaption = useCallback((kind: CaptionKind) => {
    if (!editor) return;
    const text = window.prompt(`${kind} caption text (optional):`) ?? '';
    const label = insertNumberedCaption(editor, kind, text);
    flashNotice(`Inserted ${kind} ${label}.`);
  }, [editor, flashNotice]);

  // Insert a fixed-height vertical spacer block.
  const handleInsertSpacer = useCallback(() => {
    if (!editor) return;
    const raw = window.prompt('Spacer height in pixels (2–600):', '24');
    if (raw === null) return;
    const px = parseInt(raw, 10);
    if (!Number.isFinite(px) || px <= 0) { flashError('Enter a number of pixels.'); return; }
    insertSpacer(editor, px);
    flashNotice(`Inserted a ${Math.max(2, Math.min(600, px))}px spacer.`);
  }, [editor, flashNotice, flashError]);

  // One-click page-setup preset.
  const handleApplyPagePreset = useCallback((presetId: string) => {
    const preset = PAGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setDocSettings((s) => applyPagePreset(s, preset));
    flashNotice(`Page set to ${preset.label}.`);
  }, [flashNotice]);

  // Export / copy the current selection only.
  const handleExportSelection = useCallback(async (target: 'clipboard' | 'file') => {
    if (!editor) return;
    const sel = getSelectionExport(editor);
    if (!sel) { flashError('Select some text first.'); return; }
    if (target === 'file') {
      const safe = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'selection';
      downloadFile(`${safe} - selection.html`, buildStandaloneHtml({ title: `${title} (selection)`, bodyHtml: sel.html, author, margins: docSettings.page.margins }), 'text/html');
      flashNotice('Exported the selection as HTML.');
    } else {
      try { await copyRich(sel.html); flashNotice('Copied the selection (rich text).'); }
      catch { flashError('Clipboard write blocked.'); }
    }
  }, [editor, title, author, flashNotice, flashError, docSettings.page.margins]);

  // Clear the document back to a blank page (with confirm).
  const handleClearDocument = useCallback(() => {
    if (!editor) return;
    setClearDocOpen(true);
  }, [editor]);

  // Toggle the word/character limit indicator.
  const handleToggleWordLimit = useCallback(() => {
    setWordLimitOn((on) => { const next = !on; flashNotice(`Word/char limit indicator ${next ? 'on' : 'off'}.`); return next; });
  }, [flashNotice]);

  // Configure the word/character limit target + mode.
  const handleConfigureWordLimit = useCallback(() => {
    const modeRaw = window.prompt('Limit by "words" or "characters"?', wordLimitMode);
    if (modeRaw === null) return;
    const mode = modeRaw.trim().toLowerCase().startsWith('c') ? 'characters' : 'words';
    const valRaw = window.prompt(`Limit target (${mode}):`, String(wordLimit));
    if (valRaw === null) return;
    const val = parseInt(valRaw, 10);
    if (!Number.isFinite(val) || val <= 0) { flashError('Enter a positive number.'); return; }
    setWordLimitMode(mode);
    setWordLimit(val);
    setWordLimitOn(true);
    localStorage.setItem('rmpg_writer_limit_mode', mode);
    localStorage.setItem('rmpg_writer_limit_value', String(val));
    flashNotice(`Limit set to ${val} ${mode}.`);
  }, [wordLimitMode, wordLimit, flashNotice, flashError]);

  // Export the editor's document JSON (round-trippable, lossless vs HTML).
  const handleExportJson = useCallback(() => {
    if (!editor) return;
    const payload = {
      kind: 'rmpg-flex-document',
      version: 1,
      title,
      properties: docSettings.properties,
      settings: docSettings,
      doc: editor.getJSON(),
      exportedAt: new Date().toISOString(),
    };
    const safe = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'document';
    downloadFile(`${safe}.rmpgdoc.json`, JSON.stringify(payload, null, 2), 'application/json');
  }, [editor, title, docSettings]);

  const handleImportJson = useCallback(() => jsonInputRef.current?.click(), []);
  const handleJsonFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const content = data?.doc ?? data; // accept a bare TipTap JSON doc too
        editor.commands.setContent(content);
        if (typeof data?.title === 'string') setTitle(data.title);
        if (data?.settings) setDocSettings((s) => ({ ...s, ...data.settings }));
        else if (data?.properties) setDocSettings((s) => ({ ...s, properties: { ...s.properties, ...data.properties } }));
        setSavedNotice('Document imported from JSON.');
        setTimeout(() => setSavedNotice(null), 3000);
      } catch (err) {
        console.error('[document-writer] JSON import failed:', err);
        setErrorNotice('Could not read that file — expected a document JSON export.');
        setTimeout(() => setErrorNotice(null), 4000);
      }
    };
    reader.readAsText(file);
  }, [editor]);

  // Autosave every 30s + on unload. Recovery offered on mount.
  useEffect(() => {
    if (mode !== 'edit' || !editor) return;
    const tick = () => { const at = writeDraft(title, editor.getHTML()); if (at) setAutoSavedAt(at); };
    const id = window.setInterval(tick, 30_000);
    window.addEventListener('beforeunload', tick);
    return () => { window.clearInterval(id); window.removeEventListener('beforeunload', tick); };
  }, [mode, editor, title]);

  useEffect(() => {
    if (mode !== 'edit') return;
    const d = readDraft();
    if (d && d.html && d.html.length > 40) setRecovery({ title: d.title, html: d.html });
  }, [mode]);

  // Debounced server autosave: once the document has been saved to the server at
  // least once (so a documentId exists), keep it in sync ~4s after edits stop by
  // re-uploading the HTML to /api/uploads. Reuses the same endpoint as Save.
  useEffect(() => {
    if (mode !== 'edit' || !editor) return;
    let timer: number | undefined;
    const schedule = () => {
      if (!documentIdRef.current) return; // only auto-sync documents already saved to the server
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        setServerSaveState('saving');
        try {
          const safeName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'Untitled Document';
          // Keep the server copy as an editable .docx, matching the Save path.
          const blob = htmlToDocxBlob(editor.getHTML(), docSettingsRef.current.page, {
            title: docSettingsRef.current.properties.title || title,
            author,
          });
          const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          const formData = new FormData();
          formData.append('files', new File([blob], `${safeName}.docx`, { type: docxType }));
          const folderId = searchParams.get('folderId');
          if (folderId) formData.append('folder_id', folderId);
          const token = localStorage.getItem('rmpg_token');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const res = await fetch(uploadsUrl(), { method: 'POST', headers, body: formData });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          setServerSaveState('saved');
        } catch (err) {
          console.warn('[document-writer] server autosave failed:', err);
          setServerSaveState('error');
        }
      }, 4000);
    };
    editor.on('update', schedule);
    return () => { editor.off('update', schedule); window.clearTimeout(timer); };
  }, [mode, editor, title, author, searchParams]);

  // Track the document in the local "recent documents" history (debounced).
  useEffect(() => {
    if (mode !== 'edit' || !editor) return;
    let timer: number | undefined;
    const track = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        touchRecentDoc({ id: recentIdRef.current, title, html: editor.getHTML(), documentId: documentIdRef.current ?? undefined });
      }, 5000);
    };
    track(); // record on entry
    editor.on('update', track);
    return () => { editor.off('update', track); window.clearTimeout(timer); };
  }, [mode, editor, title]);

  // On mobile, auto-fit the page width to the viewport so the (fixed-px) page
  // doesn't require horizontal scrolling. Desktop keeps zoom at its default.
  useEffect(() => {
    if (mode !== 'edit' || !isMobile) return;
    const d = PAGE_SIZES[docSettings.page.size];
    const w = docSettings.page.orientation === 'landscape' ? d.height : d.width;
    const avail = window.innerWidth - 32; // account for container padding/gutters
    if (w > avail) setZoom(Math.max(0.4, Math.round((avail / w) * 20) / 20));
  }, [mode, isMobile, docSettings.page.size, docSettings.page.orientation]);

  // Keyboard shortcuts (features 41–50).
  useEffect(() => {
    if (mode !== 'edit' || !editor) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc leaves any distraction-free view (focus / reading / fullscreen) and
      // closes the shortcuts sheet.
      if (e.key === 'Escape') { setShowShortcuts(false); setViewMode('normal'); return; }
      // "?" (Shift+/) toggles the shortcuts cheat-sheet — but not while typing in
      // the editor or a form field.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const el = e.target as HTMLElement | null;
        const typing = !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
        if (!typing) { e.preventDefault(); setShowShortcuts((v) => !v); return; }
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's' && e.shiftKey) { e.preventDefault(); handleSaveDraftNow(); }
      else if (k === 's') { e.preventDefault(); handleSave(); }
      else if (k === 'f') { e.preventDefault(); setFindMode('find'); }
      else if (k === 'h') { e.preventDefault(); setFindMode('replace'); }
      else if (k === 'k') { e.preventDefault(); const url = window.prompt('URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }
      else if (k === '1') { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 1 }).run(); }
      else if (k === '2') { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }
      else if (k === '3') { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }
      else if (k === '=' || k === '+') { e.preventDefault(); setZoom((z) => Math.min(2, z + 0.1)); }
      else if (k === '-') { e.preventDefault(); setZoom((z) => Math.max(0.5, z - 0.1)); }
      else if (k === '0') { e.preventDefault(); setZoom(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, editor, handleSave, handleSaveDraftNow]);

  // Stop any in-progress read-aloud when the writer unmounts.
  useEffect(() => () => { readAloudRef.current?.stop(); }, []);

  // Apply persisted editor appearance to the page element once it's mounted in
  // edit mode (and re-apply if the appearance object changes).
  useEffect(() => {
    if (mode === 'edit') applyAppearance(pageRef.current, appearance);
  }, [mode, appearance]);

  // Keep the suggestion (insertion) mark active as the user moves the caret
  // while suggestion mode is on, so newly typed text stays tracked.
  useEffect(() => {
    if (mode !== 'edit' || !editor || !suggestMode) return;
    const reArm = () => {
      if (!editor.isActive('suggestion')) {
        editor.commands.setMark('suggestion', { change: 'ins' });
      }
    };
    editor.on('selectionUpdate', reArm);
    return () => { editor.off('selectionUpdate', reArm); };
  }, [mode, editor, suggestMode]);

  if (mode === 'choose') {
    return (
      <div className="h-[calc(100vh-140px)] overflow-hidden border border-border-default rounded-[2px]">
        <TemplateChooser onSelect={handleTemplateSelect} />
      </div>
    );
  }

  const dim = PAGE_SIZES[docSettings.page.size];
  const landscape = docSettings.page.orientation === 'landscape';
  const pageW = landscape ? dim.height : dim.width;
  const pageH = landscape ? dim.width : dim.height;
  const pageBg = theme === 'dark' ? '#1e1e1e' : docSettings.background;
  // Document body text — a LITERAL on purpose, never a theme token. This is the
  // user's document as it will print and export, not app chrome, so it must not
  // follow the app palette. Was `var(--surface-base)`, which resolves to the
  // Blue & Silver navy #22405f and rendered document text navy-on-white in light
  // mode (and exported that way to PDF). The dark branch is a screen-only
  // dark-editing affordance; the light branch is the real print appearance.
  const textColor = theme === 'dark' ? '#e8e8e8' : '#1a1a1a';
  const m = docSettings.page.margins;
  const reading = viewMode === 'reading';
  const fullscreen = viewMode === 'fullscreen';
  const focusMode = viewMode === 'focus';
  const contentClasses = ['writer-content',
    docSettings.columns === 2 ? 'cols-2' : docSettings.columns === 3 ? 'cols-3' : '',
    docSettings.lineNumbers ? 'line-numbers' : '', docSettings.widowControl ? 'widow-control' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={`p-3 flex flex-col h-[calc(100vh-140px)] ${fullscreen || focusMode ? 'fixed inset-0 z-[60] bg-surface-overlay h-screen' : ''}`}>
      {!reading && !focusMode && <PanelTitleBar title="DOCUMENT WRITER" icon={FileText} />}

      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <input ref={bgImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgImageFile} />
      <input ref={jsonInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleJsonFile} />

      {recovery && (
        <div className="bg-amber-900/20 border border-amber-700/40 text-amber-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>Recovered an unsaved draft ("{recovery.title}").</span>
          <button type="button" onClick={() => { editor?.commands.setContent(recovery.html); setTitle(recovery.title); setRecovery(null); }} className="ml-auto text-amber-300 hover:text-rmpg-100 text-[10px] underline">Restore</button>
          <button type="button" onClick={() => { clearDraft(); setRecovery(null); }} className="text-amber-300/70 hover:text-rmpg-100 text-[10px]">Discard</button>
        </div>
      )}
      {savedNotice && (
        <div className="bg-green-900/20 border border-green-700/40 text-green-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>{savedNotice}</span>
          <button type="button" onClick={() => navigate('/documents')} className="ml-auto text-green-300 hover:text-rmpg-100 text-[10px]">Open Documents →</button>
        </div>
      )}
      {errorNotice && (
        <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-[2px] mt-2 flex items-center gap-2">
          <span>{errorNotice}</span>
          <button type="button" onClick={() => setErrorNotice(null)} className="ml-auto text-red-300 hover:text-rmpg-100 text-[10px]">Dismiss</button>
        </div>
      )}

      {!reading && (
        <div className="mt-2">
          <WriterToolbar
            editor={editor} docSettings={docSettings} setDocSettings={setDocSettings}
            theme={theme} onToggleTheme={toggleTheme}
            onSave={handleSave} onExportPdf={handleExportPdf} onPrint={handleExportPdf}
            onInsertImage={handleInsertImage} onInsertBackgroundImage={handleInsertBackgroundImage}
            saving={saving} title={title} author={author} onTitleChange={setTitle}
            ext={{
              onFind: () => setFindMode('find'), onReplace: () => setFindMode('replace'),
              onToggleOutline: () => setShowOutline((v) => !v), onToggleComments: () => setShowComments((v) => !v),
              onAddComment: handleAddComment, onSnapshot: handleSnapshot,
              onExport: handleExport, onExportDocx: handleExportDocx, onEmail: handleEmailDoc, onPastePlain: handlePastePlain, onCopyAs: handleCopyAs,
              onInsertEmbed: handleInsertEmbed, zoom, setZoom, viewMode, setViewMode,
              language, setLanguage, autoSavedAt,
              onToggleSnapshots: () => setShowSnapshots((v) => !v),
              onOpenProperties: () => setShowProperties(true),
              onReadAloud: handleReadAloud, readingAloud,
              onExportJson: handleExportJson, onImportJson: handleImportJson,
              onToggleAnalysis: () => setShowAnalysis((v) => !v),
              onOpenPalette: () => setShowPalette(true),
              onBrush: handleBrush, brushActive: !!brush,
              onTransform: handleTransform,
              onInsertCsv: handleInsertCsv, onInsertStatute: handleInsertStatute,
              onShortcuts: () => setShowShortcuts(true),
              onOfficerSignature: handleOfficerSignature,
              onExportStandaloneHtml: handleExportStandaloneHtml,
              onDuplicate: handleDuplicate,
              onSaveDraftNow: handleSaveDraftNow,
              onToggleRecent: () => setShowRecent((v) => !v),
              serverSaveState,
              flash: (m: string) => flashNotice(m),
              // This wave's new features
              onToggleMerge: () => setShowMerge((v) => !v),
              onToggleProofread: () => setShowProofread((v) => !v),
              onToggleSections: () => setShowSections((v) => !v),
              onToggleTrackChanges: () => setShowTrackChanges((v) => !v),
              onToggleMinimap: () => setShowMinimap((v) => !v),
              onOpenAppearance: () => setShowAppearance(true),
              onToggleRedaction: handleToggleRedaction,
              onToggleSuggestMode: handleToggleSuggestMode,
              suggestMode,
              onToggleAutocomplete: handleToggleAutocomplete,
              autocompleteOn,
              // Final wave
              onInsertCaption: handleInsertCaption,
              onInsertSpacer: handleInsertSpacer,
              onApplyPagePreset: handleApplyPagePreset,
              onExportSelection: handleExportSelection,
              onClearDocument: handleClearDocument,
              onToggleWordLimit: handleToggleWordLimit,
              onConfigureWordLimit: handleConfigureWordLimit,
              wordLimitOn,
              onToggleReorder: () => setShowReorder((v) => !v),
              onToggleMacro: () => setShowMacro((v) => !v),
              onToggleRefiners: () => setShowRefiners((v) => !v),
              refinersOpen: showRefiners,
            }}
          />
        </div>
      )}

      {wordLimitOn && !reading && editor && (
        <WordLimitBar editor={editor} mode={wordLimitMode} limit={wordLimit} onClose={() => setWordLimitOn(false)} />
      )}

      {docSettings.showRuler && !reading && !focusMode && (
        <div className="mt-2 flex justify-center"><div className="writer-ruler" style={{ width: pageW }} /></div>
      )}

      <div className="flex-1 mt-3 overflow-auto bg-surface-overlay border border-border-default rounded-[2px] flex gap-2 p-2 relative">
        {showOutline && !focusMode && editor && <OutlinePane editor={editor} onClose={() => setShowOutline(false)} />}

        <div className="writer-scroll flex-1 overflow-auto flex justify-center relative">
          {findMode && editor && <FindReplacePanel editor={editor} mode={findMode} onClose={() => setFindMode(null)} />}
          {editor && <Autocomplete editor={editor} enabled={autocompleteOn && !reading} />}
          {editor && !reading && <SelectionToolbar editor={editor} onComment={handleAddComment} />}
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
            <div
              ref={pageRef}
              className={`writer-page my-3 md:my-6 shadow-2xl shadow-black/50 ${docSettings.pageBorder ? `has-page-border border-${docSettings.pageBorderStyle || 'thin'}` : ''}`}
              style={{
                width: reading ? Math.min(pageW, 760) : pageW, minHeight: pageH,
                background: theme === 'dark' ? pageBg : (appearance.paperTint || pageBg), color: textColor,
                paddingTop: m.top, paddingRight: m.right, paddingBottom: m.bottom, paddingLeft: m.left,
                backgroundImage: docSettings.backgroundImage ? `url(${docSettings.backgroundImage})` : undefined,
                backgroundSize: 'cover',
              }}
            >
              {docSettings.watermark.text && <div className="doc-watermark" style={{ opacity: docSettings.watermark.opacity, color: textColor }}>{docSettings.watermark.text}</div>}
              {docSettings.letterhead && (
                <div className="writer-letterhead">
                  <div className="lh-name">ROCKY MOUNTAIN PROTECTIVE GROUP</div>
                  <div className="lh-sub">Law Enforcement &amp; Private Security Services — Salt Lake City, Utah</div>
                </div>
              )}
              {docSettings.header.enabled && (
                <div className="doc-running-header"><span>{docSettings.header.text}</span>{docSettings.header.showPageNumber && <span>Page 1</span>}</div>
              )}
              <EditorContent editor={editor} className={contentClasses} />
              {docSettings.footer.enabled && (
                <div className="doc-running-footer">
                  <span>{docSettings.footer.text}</span>
                  <span>{[docSettings.footer.showDate ? new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '', docSettings.footer.showAuthor ? author : ''].filter(Boolean).join(' • ')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {showSnapshots && !focusMode && editor && <SnapshotsPanel editor={editor} title={title} onClose={() => setShowSnapshots(false)} onRestore={() => { setRecovery(null); }} />}

        {showAnalysis && !focusMode && editor && <AnalysisPanel editor={editor} onClose={() => setShowAnalysis(false)} />}

        {showComments && !focusMode && editor && <CommentsSidebar editor={editor} comments={comments} setComments={setComments} author={author} onClose={() => setShowComments(false)} />}

        {showFeatures && <FeaturesPanel editor={editor} onClose={() => setShowFeatures(false)} caseUrl={typeof window !== 'undefined' ? window.location.href : undefined} />}

        {showMerge && !focusMode && editor && (
          <MergePanel editor={editor} officer={{ name: author, badge: user?.badge_number, rank: user?.rank, department: user?.department }}
            onClose={() => setShowMerge(false)} flash={(msg) => flashNotice(msg)} />
        )}

        {showProofread && !focusMode && editor && <ProofreadPanel editor={editor} onClose={() => setShowProofread(false)} flash={(msg) => flashNotice(msg)} />}

        {showSections && !focusMode && editor && <SectionsPanel editor={editor} onClose={() => setShowSections(false)} />}

        {showTrackChanges && !focusMode && editor && (
          <TrackChangesPanel editor={editor} suggestMode={suggestMode} onToggleMode={handleToggleSuggestMode}
            onClose={() => setShowTrackChanges(false)} flash={(msg) => flashNotice(msg)} />
        )}

        {showRefiners && !focusMode && editor && (
          <RefinersPanel editor={editor} onClose={() => setShowRefiners(false)} flash={(msg) => flashNotice(msg)} />
        )}

        {showMinimap && !focusMode && editor && <Minimap editor={editor} scrollSelector=".writer-scroll" onClose={() => setShowMinimap(false)} />}

        {showReorder && !focusMode && editor && <OutlineReorder editor={editor} onClose={() => setShowReorder(false)} flash={(msg) => flashNotice(msg)} />}

        {showMacro && !focusMode && editor && <MacroRecorder editor={editor} onClose={() => setShowMacro(false)} flash={(msg) => flashNotice(msg)} />}

        {showRecent && !focusMode && (
          <RecentDocsPanel
            key={recentTick}
            onClose={() => setShowRecent(false)}
            onOpen={handleOpenRecent}
            onChange={() => setRecentTick((t) => t + 1)}
          />
        )}

        {!showFeatures && (
          <button
            type="button"
            title="Open Tools, Snippets, Statutes, Persons, CFS, and more (140+ snippets, 25+ insert tools)"
            onClick={() => setShowFeatures(true)}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium bg-surface-base border border-accent-silver-600/30 text-accent-silver-500 rounded-[2px] hover:bg-accent-silver-500/10"
          >
            <Sparkles className="w-3 h-3" /> Tools
          </button>
        )}

        {/* Zoom controls + reading-mode exit */}
        <div className="absolute bottom-2 right-3 flex items-center gap-1 bg-surface-base/90 border border-border-default rounded-[2px] px-1.5 py-1">
          <button type="button" title="Zoom out (Ctrl+-)" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} className="text-rmpg-400 hover:text-rmpg-100"><ZoomOut className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] text-rmpg-400 w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" title="Zoom in (Ctrl+=)" onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="text-rmpg-400 hover:text-rmpg-100"><ZoomIn className="w-3.5 h-3.5" /></button>
          {(reading || fullscreen || focusMode) && (
            <button type="button" title="Exit (Esc)" onClick={() => setViewMode('normal')} className="ml-1 text-rmpg-400 hover:text-rmpg-100"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>

      {!reading && !focusMode && editor && <StatusBar editor={editor} />}

      {!reading && !focusMode && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[9px] text-rmpg-600 px-1">
          <span>{docSettings.page.size.toUpperCase()} • {docSettings.page.orientation} • {theme} mode{autoSavedAt ? ` • autosaved ${new Date(autoSavedAt).toLocaleTimeString('en-US', { timeZone: 'America/Denver' })}` : ''}</span> // new-date-ok
          <span className={documentId ? 'text-green-500/70' : ''}>{documentId ? `Saved • ID: ${documentId.slice(0, 8)}` : 'Unsaved'}</span>
          <span>{author}</span>
        </div>
      )}

      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}

      {showProperties && (
        <DocPropertiesDialog
          value={docSettings.properties}
          defaultAuthor={author}
          editor={editor}
          onSave={(props) => {
            setDocSettings((s) => ({ ...s, properties: props }));
            if (props.title && props.title !== title) setTitle(props.title);
          }}
          onClose={() => setShowProperties(false)}
        />
      )}

      {showAppearance && (
        <AppearanceDialog value={appearance} onChange={handleAppearanceChange} onClose={() => setShowAppearance(false)} />
      )}
      <ConfirmDialog
        isOpen={clearDocOpen}
        onClose={() => setClearDocOpen(false)}
        onConfirm={() => {
          if (!editor) return;
          clearDocument(editor);
          flashNotice('Document cleared.');
          setClearDocOpen(false);
        }}
        title="Clear document"
        message="Clear the entire document? This replaces all content with a blank page. Undo with Ctrl+Z."
        confirmLabel="Clear"
        confirmVariant="warning"
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  // Escape quotes too — escapeHtml() output is interpolated into HTML attributes
  // (meta content="…", titles, header/footer/watermark text).
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
