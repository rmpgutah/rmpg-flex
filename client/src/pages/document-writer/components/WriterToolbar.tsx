import { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, List, ListOrdered, Table as TableIcon, Image as ImageIcon,
  Undo2, Redo2, Heading1, Heading2, Heading3, Minus, Quote, Code, Superscript,
  Subscript, RemoveFormatting, CheckSquare, Link2, Printer, Download, Save, FileText,
  Type, Pilcrow, LayoutPanelTop, PlusSquare, Sun, Moon, BarChart3, BookTemplate,
  Baseline, PaintBucket, Search, MessageSquare, Eye, FileDown, Grid3x3, Focus,
  Quote as QuoteIcon, Omega, Volume2, VolumeX, Camera, Info, ListTree,
  Paintbrush, Gauge, CaseSensitive, Scale, Sheet,
  Keyboard, FileSignature, ArrowDownUp, FileStack, Copy, Layers,
  ChevronsUp, ChevronsDown, TextSelect, FileCode2,
  Merge, SpellCheck2, ListChecks, GitPullRequestArrow, Map as MapIcon,
  Sliders, SquareSlash, Lightbulb, Wrench,
} from 'lucide-react';
import ToolbarMenu, { MenuRow, MenuButton } from './ToolbarMenu';
import {
  insertTableOfContents, insertFootnote, insertEndnote, insertBookmark,
  insertCrossReference, insertCoverPage, insertField, insertMarginNote, insertTabStop,
  insertDateTime, insertSectionHeading,
  insertTableOfContentsAtCursor, insertSignatureLine, insertFillableField,
  insertSpecialChar, applySmartQuotes, applyOutlineNumbering, clearOutlineNumbering,
  SPECIAL_CHARS,
  computeStats, listSavedTemplates, saveTemplate, deleteTemplate,
} from '../docActions';
import { snippetsByCategory, type Snippet } from '../snippets';
import {
  insertOfficerSignatureBlock, textToList, listToText, sortList, sortTableRows,
  sectionBlocksByGroup, insertSectionBlock, selectAll, goToTop, goToBottom,
  type SortMode, type SectionBlock,
} from '../docTools';
import { FONT_FAMILIES, FONT_SIZES, type DocSettings, type WriterTheme } from '../types';

/** Page-level actions/state the toolbar drives (find/replace, comments, view,
 *  export, clipboard, media) — bundled to keep the prop list manageable. */
export interface WriterExtActions {
  onFind: () => void;
  onReplace: () => void;
  onToggleOutline: () => void;
  onToggleComments: () => void;
  onAddComment: () => void;
  onSnapshot: () => void;
  onExport: (format: 'md' | 'txt' | 'rtf' | 'html') => void;
  onEmail: () => void;
  onPastePlain: () => void;
  onCopyAs: (format: 'plain' | 'html' | 'md') => void;
  onInsertEmbed: (kind: 'video' | 'audio' | 'iframe') => void;
  zoom: number;
  setZoom: (updater: (z: number) => number) => void;
  viewMode: 'normal' | 'reading' | 'fullscreen' | 'focus';
  setViewMode: (m: 'normal' | 'reading' | 'fullscreen' | 'focus') => void;
  language: string;
  setLanguage: (l: string) => void;
  autoSavedAt: string | null;
  // Wave-2 actions
  onToggleSnapshots: () => void;
  onOpenProperties: () => void;
  onReadAloud: () => void;
  readingAloud: boolean;
  onExportJson: () => void;
  onImportJson: () => void;
  // Wave-3 actions
  onToggleAnalysis: () => void;
  onBrush: () => void;
  brushActive: boolean;
  onTransform: (mode: 'upper' | 'lower' | 'title' | 'sentence') => void;
  onInsertCsv: () => void;
  onInsertStatute: () => void;
  // This wave
  onShortcuts: () => void;
  onOfficerSignature: () => void;
  onExportStandaloneHtml: () => void;
  onDuplicate: () => void;
  onSaveDraftNow: () => void;
  onToggleRecent: () => void;
  /** Server-autosave indicator: idle | saving | saved | error. */
  serverSaveState: 'idle' | 'saving' | 'saved' | 'error';
  flash: (msg: string) => void;
  // New features (this wave)
  onToggleMerge: () => void;
  onToggleProofread: () => void;
  onToggleSections: () => void;
  onToggleTrackChanges: () => void;
  onToggleMinimap: () => void;
  onOpenAppearance: () => void;
  onToggleRedaction: () => void;
  onToggleSuggestMode: () => void;
  suggestMode: boolean;
  onToggleAutocomplete: () => void;
  autocompleteOn: boolean;
}

interface Props {
  editor: Editor | null;
  docSettings: DocSettings;
  setDocSettings: (updater: (s: DocSettings) => DocSettings) => void;
  theme: WriterTheme;
  onToggleTheme: () => void;
  onSave: () => void;
  onExportPdf: () => void;
  onPrint: () => void;
  onInsertImage: () => void;
  onInsertBackgroundImage: () => void;
  saving: boolean;
  title: string;
  author: string;
  onTitleChange: (title: string) => void;
  ext: WriterExtActions;
}

function ToolBtn({ active, disabled, onClick, children, title }: {
  active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; title: string;
}) {
  return (
    <button
      type="button" title={title} disabled={disabled} onClick={onClick}
      className={`p-1.5 rounded-[2px] transition-colors ${
        active ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-400 hover:text-rmpg-200 hover:bg-[#1a1a1a]'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}
function Divider() { return <div className="w-px h-5 bg-[#222] mx-1" />; }
const selCls = 'bg-[#141414] border border-[#222] text-rmpg-200 text-[10px] rounded-[2px] px-1 py-0.5 focus:outline-none focus:border-[#d4a017]/50';

export default function WriterToolbar({
  editor, docSettings, setDocSettings, theme, onToggleTheme,
  onSave, onExportPdf, onPrint, onInsertImage, onInsertBackgroundImage,
  saving, title, author, onTitleChange, ext,
}: Props) {
  if (!editor) return null;

  const stats = computeStats(editor);
  const inTable = editor.isActive('table');
  const snippetGroups = snippetsByCategory();
  const insertSnippet = (s: Snippet) => editor.chain().focus().insertContent(s.html).run();
  const sectionGroups = sectionBlocksByGroup();
  const addSection = (b: SectionBlock) => insertSectionBlock(editor, b);
  const doTextToList = (ordered: boolean) => {
    const n = textToList(editor, ordered);
    ext.flash(n ? `Converted ${n} line(s) to a list.` : 'Select two or more lines of text first.');
  };
  const doListToText = () => {
    if (!listToText(editor)) ext.flash('Place the cursor inside a list first.');
  };
  const doSortList = (mode: SortMode) => {
    const n = sortList(editor, mode);
    ext.flash(n ? `Sorted ${n} list items.` : 'Place the cursor in a list with 2+ items first.');
  };
  const doSortTable = (mode: SortMode) => {
    const n = sortTableRows(editor, mode);
    ext.flash(n ? `Sorted ${n} table rows by the first column.` : 'Place the cursor in a table with 2+ body rows first.');
  };
  const setBlock = (attrs: Record<string, string | null>) => editor.chain().focus().setBlockStyle(attrs).run();
  const setPage = (patch: Partial<DocSettings['page']>) => setDocSettings((s) => ({ ...s, page: { ...s.page, ...patch } }));
  const setMargin = (side: keyof DocSettings['page']['margins'], v: number) =>
    setDocSettings((s) => ({ ...s, page: { ...s.page, margins: { ...s.page.margins, [side]: v } } }));

  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-[2px] p-1.5">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-2 mb-1.5 pb-1.5 border-b border-[#1a1a1a]">
        <FileText className="w-4 h-4 text-[#d4a017] flex-shrink-0" />
        <input
          type="text" value={title} onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Document"
          className="flex-1 min-w-[140px] bg-transparent border-none text-sm text-rmpg-100 font-semibold focus:outline-none placeholder-rmpg-600"
        />
        <button type="button" onClick={ext.onReadAloud}
          title={ext.readingAloud ? 'Stop reading aloud' : 'Read document (or selection) aloud'}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] border rounded-[2px] ${
            ext.readingAloud ? 'bg-[#d4a017]/20 border-[#d4a017]/40 text-[#d4a017]' : 'bg-[#141414] border-[#222] text-rmpg-300 hover:bg-[#1a1a1a]'
          }`}>
          {ext.readingAloud ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
          {ext.readingAloud ? 'Stop' : 'Read'}
        </button>
        <button type="button" onClick={ext.onOpenProperties}
          title="Document properties (title, author, subject, keywords)"
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          <Info className="w-3 h-3" />Props
        </button>
        <button type="button" onClick={() => ext.setViewMode(ext.viewMode === 'focus' ? 'normal' : 'focus')}
          title="Focus / Zen mode — hide panels and chrome for distraction-free writing"
          className={`flex items-center gap-1 px-2 py-1 text-[10px] border rounded-[2px] ${
            ext.viewMode === 'focus' ? 'bg-[#d4a017]/20 border-[#d4a017]/40 text-[#d4a017]' : 'bg-[#141414] border-[#222] text-rmpg-300 hover:bg-[#1a1a1a]'
          }`}>
          <Focus className="w-3 h-3" />Focus
        </button>
        <button type="button" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button type="button" onClick={ext.onShortcuts} title="Keyboard shortcuts (press ?)" aria-label="Keyboard shortcuts"
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          <Keyboard className="w-3 h-3" />?
        </button>
        {/* Server-autosave indicator (appears once a server document id exists) */}
        {ext.serverSaveState !== 'idle' && (
          <span title="Autosave to Documents server"
            className={`text-[9px] px-1.5 py-1 rounded-[2px] border ${
              ext.serverSaveState === 'saving' ? 'text-rmpg-400 border-[#222] bg-[#141414]'
              : ext.serverSaveState === 'saved' ? 'text-green-400/80 border-green-700/30 bg-green-900/10'
              : 'text-red-400/80 border-red-700/30 bg-red-900/10'
            }`}>
            {ext.serverSaveState === 'saving' ? 'Syncing…' : ext.serverSaveState === 'saved' ? 'Synced' : 'Sync failed'}
          </span>
        )}
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

      {/* Main toolbar */}
      <div className="flex items-center flex-wrap gap-0.5">
        <ToolBtn title="Undo (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Redo (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="w-3.5 h-3.5" /></ToolBtn>
        <Divider />

        {/* Font family (1) + size (2) */}
        <select className={selCls} title="Font family" defaultValue=""
          onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontFamily(v).run(); else editor.chain().focus().unsetFontFamily().run(); }}>
          <option value="">Font</option>
          {FONT_FAMILIES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select className={selCls} title="Font size" defaultValue=""
          onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontSize(`${v}pt`).run(); else editor.chain().focus().unsetFontSize().run(); }}>
          <option value="">Size</option>
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Text color (3) + highlight (4) */}
        <label className="p-1 cursor-pointer" title="Text color">
          <Baseline className="w-3.5 h-3.5 text-rmpg-400" />
          <input type="color" className="sr-only" onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
        </label>
        <label className="p-1 cursor-pointer" title="Highlight color">
          <PaintBucket className="w-3.5 h-3.5 text-rmpg-400" />
          <input type="color" className="sr-only" onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()} />
        </label>
        <Divider />

        {/* Inline marks (5,6,7 + bold/italic/underline/code) */}
        <ToolBtn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}><Superscript className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}><Subscript className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title={ext.brushActive ? 'Format brush armed — select target text and click to apply' : 'Format brush — capture formatting from the selection, then apply to the next'} active={ext.brushActive} onClick={ext.onBrush}><Paintbrush className="w-3.5 h-3.5" /></ToolBtn>

        {/* Advanced text menu (8–15) */}
        <ToolbarMenu label="Text" icon={Type} width={250}>
          <MenuButton onClick={() => editor.chain().focus().setSmallCaps(true).run()}>Small caps</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setSmallCaps(false).run()}>Normal caps</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextTransform('uppercase').run()}>ALL CAPS</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextTransform(null).run()}>Clear caps transform</MenuButton>
          <MenuRow label="Letter spacing">
            <select className={selCls} defaultValue="" onChange={(e) => editor.chain().focus().setLetterSpacing(e.target.value).run()}>
              {['', 'normal', '0.5px', '1px', '2px', '3px', '-0.5px'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Line height">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ lineHeight: e.target.value || null })}>
              {['', '1', '1.15', '1.5', '2', '2.5', '3'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Font weight">
            <select className={selCls} defaultValue="" onChange={(e) => editor.chain().focus().setFontWeight(e.target.value).run()}>
              {['', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Text opacity">
            <select className={selCls} defaultValue="" onChange={(e) => editor.chain().focus().setTextOpacity(e.target.value).run()}>
              {['', '1', '0.8', '0.6', '0.4', '0.2'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuButton onClick={() => editor.chain().focus().setTextShadow('1px 1px 2px rgba(0,0,0,0.5)').run()}>Text shadow on</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setTextShadow('none').run()}>Text shadow off</MenuButton>
          <MenuButton onClick={() => setBlock({ dropCap: 'true' })}>Drop cap (first letter)</MenuButton>
          <MenuButton onClick={() => setBlock({ dropCap: null })}>Remove drop cap</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
            <span className="flex items-center gap-1"><RemoveFormatting className="w-3 h-3" /> Clear all formatting</span>
          </MenuButton>
        </ToolbarMenu>

        {/* Case transforms (wave 3) — operate on the current selection */}
        <ToolbarMenu label="Case" icon={CaseSensitive} width={180}>
          <MenuButton onClick={() => ext.onTransform('upper')}>UPPERCASE</MenuButton>
          <MenuButton onClick={() => ext.onTransform('lower')}>lowercase</MenuButton>
          <MenuButton onClick={() => ext.onTransform('title')}>Title Case</MenuButton>
          <MenuButton onClick={() => ext.onTransform('sentence')}>Sentence case</MenuButton>
          <div className="text-[9px] text-rmpg-600 px-2 pt-1 leading-snug">Select text first, then choose a case.</div>
        </ToolbarMenu>
        <Divider />

        {/* Alignment */}
        <ToolBtn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify className="w-3.5 h-3.5" /></ToolBtn>

        {/* Paragraph & layout menu (16–30) */}
        <ToolbarMenu label="Paragraph" icon={Pilcrow} width={260}>
          <MenuRow label="Space before">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ spaceBefore: e.target.value || null })}>
              {['', '4px', '8px', '12px', '18px', '24px'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Space after">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ spaceAfter: e.target.value || null })}>
              {['', '4px', '8px', '12px', '18px', '24px'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="First-line indent">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ firstLineIndent: e.target.value || null })}>
              {['', '0.25in', '0.5in', '0.75in', '1in'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Hanging indent">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ hangingIndent: e.target.value || null })}>
              {['', '0.25in', '0.5in', '0.75in'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Columns">
            <select className={selCls} value={docSettings.columns} onChange={(e) => setDocSettings((s) => ({ ...s, columns: Number(e.target.value) as 1 | 2 | 3 }))}>
              {[1, 2, 3].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Direction">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ textDirection: e.target.value || null })}>
              {[['', '—'], ['ltr', 'LTR'], ['rtl', 'RTL']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Vertical align">
            <select className={selCls} defaultValue="" onChange={(e) => setBlock({ verticalAlign: e.target.value || null })}>
              {['', 'top', 'middle', 'bottom'].map((v) => <option key={v} value={v}>{v || '—'}</option>)}
            </select>
          </MenuRow>
          <MenuButton onClick={() => setBlock({ paragraphBorder: '1px solid currentColor' })}>Paragraph border</MenuButton>
          <MenuButton onClick={() => setBlock({ paragraphBorder: null })}>Remove border</MenuButton>
          <MenuRow label="Shading">
            <input type="color" onChange={(e) => setBlock({ paragraphShading: e.target.value })} />
          </MenuRow>
          <MenuButton onClick={() => setBlock({ breakControl: 'avoid' })}>Keep with next</MenuButton>
          <MenuButton active={docSettings.widowControl} onClick={() => setDocSettings((s) => ({ ...s, widowControl: !s.widowControl }))}>Widow/orphan control: {docSettings.widowControl ? 'On' : 'Off'}</MenuButton>
          <MenuButton active={docSettings.lineNumbers} onClick={() => setDocSettings((s) => ({ ...s, lineNumbers: !s.lineNumbers }))}>Line numbers: {docSettings.lineNumbers ? 'On' : 'Off'}</MenuButton>
          <MenuButton active={docSettings.showRuler} onClick={() => setDocSettings((s) => ({ ...s, showRuler: !s.showRuler }))}>Ruler/margin guides: {docSettings.showRuler ? 'On' : 'Off'}</MenuButton>
          <MenuButton onClick={() => insertTabStop(editor)}>Insert tab stop</MenuButton>
        </ToolbarMenu>
        <Divider />

        {/* Styles menu (headings, title/subtitle, custom styles 37/48) */}
        <ToolbarMenu label="Styles" icon={Heading1} width={210}>
          <div className="text-[10px] text-rmpg-500 pb-0.5">Paragraph presets</div>
          {/* Quick presets: apply a block type to the current paragraph in one click. */}
          <MenuButton active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>Normal</MenuButton>
          {[1, 2, 3].map((lvl) => (
            <MenuButton key={lvl} active={editor.isActive('heading', { level: lvl })} onClick={() => editor.chain().focus().setHeading({ level: lvl as 1 | 2 | 3 }).run()}>Heading {lvl}</MenuButton>
          ))}
          <MenuButton active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>Heading 4</MenuButton>
          <MenuButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Quote</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setParagraph().insertContent('<ol class="style-legal-list"><li></li></ol>').run()}>Legal-numbered list</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1 pb-0.5">Document styles</div>
          <MenuButton onClick={() => editor.chain().focus().insertContent('<p class="doc-title">Document Title</p>').run()}>Title style</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().insertContent('<p class="doc-subtitle">Subtitle</p>').run()}>Subtitle style</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().insertContent('<p class="style-legal">Legal-style paragraph (double-spaced)</p>').run()}>Legal style</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().insertContent('<p class="style-memo">Memo-style paragraph</p>').run()}>Memo style</MenuButton>
        </ToolbarMenu>

        {/* Lists */}
        <ToolBtn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Task list" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="w-3.5 h-3.5" /></ToolBtn>
        <ToolBtn title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="w-3.5 h-3.5" /></ToolBtn>
        <Divider />

        {/* Insert menu (tables/images/links/breaks/references 20,21,38,43–47) */}
        <ToolbarMenu label="Insert" icon={PlusSquare} width={230}>
          <MenuButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><span className="flex items-center gap-1"><TableIcon className="w-3 h-3" /> Table</span></MenuButton>
          <MenuButton onClick={ext.onInsertCsv}><span className="flex items-center gap-1"><Sheet className="w-3 h-3" /> Table from CSV/TSV…</span></MenuButton>
          <MenuButton onClick={ext.onInsertStatute}><span className="flex items-center gap-1"><Scale className="w-3 h-3" /> Utah Code citation…</span></MenuButton>
          <MenuButton onClick={onInsertImage}><span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Image</span></MenuButton>
          <MenuButton onClick={() => { const url = window.prompt('URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }}><span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> Link</span></MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setPageBreak().run()}>Page break</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setSectionBreak().run()}>Section break</MenuButton>
          <MenuButton onClick={() => insertTableOfContents(editor)}>Table of contents (top)</MenuButton>
          <MenuButton onClick={() => insertTableOfContentsAtCursor(editor)}>Table of contents (at cursor)</MenuButton>
          <MenuButton onClick={() => { const r = window.prompt('Signature line label (e.g. Officer, Witness):', 'Officer'); if (r) insertSignatureLine(editor, r); }}>Signature line…</MenuButton>
          <MenuButton onClick={ext.onOfficerSignature}><span className="flex items-center gap-1"><FileSignature className="w-3 h-3" /> Officer signature block (auto-fill)</span></MenuButton>
          <MenuButton onClick={() => insertFillableField(editor)}>Fillable blank [____]</MenuButton>
          <MenuButton onClick={() => insertFootnote(editor)}>Footnote</MenuButton>
          <MenuButton onClick={() => insertEndnote(editor)}>Endnote</MenuButton>
          <MenuButton onClick={() => insertCrossReference(editor)}>Cross-reference</MenuButton>
          <MenuButton onClick={() => insertBookmark(editor)}>Bookmark</MenuButton>
          <MenuButton onClick={() => insertMarginNote(editor)}>Margin note</MenuButton>
          <MenuButton onClick={() => insertCoverPage(editor, title, author)}>Cover page</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'page')}>Page-number field</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'date')}>Date field</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'author', author)}>Author field</MenuButton>
          <MenuButton onClick={() => insertDateTime(editor, 'date')}>Current date (text)</MenuButton>
          <MenuButton onClick={() => insertDateTime(editor, 'time')}>Current time (text)</MenuButton>
          <MenuButton onClick={() => insertDateTime(editor, 'datetime')}>Current date &amp; time (text)</MenuButton>
          <MenuButton onClick={() => insertSectionHeading(editor, 2)}>Numbered section heading…</MenuButton>
          <MenuButton onClick={() => ext.onInsertEmbed('video')}>Video embed (YouTube/Vimeo)</MenuButton>
          <MenuButton onClick={() => ext.onInsertEmbed('audio')}>Audio player</MenuButton>
          <MenuButton onClick={() => ext.onInsertEmbed('iframe')}>Embed / iframe</MenuButton>
          <MenuButton onClick={() => { const url = window.prompt('Image URL:'); if (url) editor.chain().focus().setImage({ src: url }).run(); }}>Image from URL</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().toggleCodeBlock().run()}>Code block</MenuButton>
        </ToolbarMenu>

        {/* Snippets — common reusable boilerplate inserted at the cursor */}
        <ToolbarMenu label="Snippets" icon={QuoteIcon} width={250}>
          {(close) => (
            <>
              {Object.entries(snippetGroups).map(([group, items]) => (
                <div key={group} className="space-y-0.5">
                  <div className="text-[10px] text-rmpg-500 uppercase tracking-wide pt-1">{group}</div>
                  {items.map((s) => (
                    <MenuButton key={s.id} onClick={() => { insertSnippet(s); close(); }}>{s.label}</MenuButton>
                  ))}
                </div>
              ))}
            </>
          )}
        </ToolbarMenu>

        {/* Special characters / symbol picker */}
        <ToolbarMenu label="Symbols" icon={Omega} width={250}>
          {(close) => (
            <>
              {SPECIAL_CHARS.map((grp) => (
                <div key={grp.group}>
                  <div className="text-[10px] text-rmpg-500 uppercase tracking-wide pt-1 pb-0.5">{grp.group}</div>
                  <div className="flex flex-wrap gap-0.5">
                    {grp.chars.map((ch) => (
                      <button key={ch} type="button" title={ch}
                        onClick={() => { insertSpecialChar(editor, ch); }}
                        className="w-7 h-7 flex items-center justify-center text-[14px] text-rmpg-100 bg-[#141414] border border-[#222] rounded-[2px] hover:bg-[#d4a017]/20 hover:text-[#d4a017]">
                        {ch}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="pt-1"><MenuButton onClick={close}>Close</MenuButton></div>
            </>
          )}
        </ToolbarMenu>

        {/* Edit menu — find/replace + clipboard (features 1–9, 21, 26–30) */}
        <ToolbarMenu label="Edit" icon={Search} width={210}>
          <MenuButton onClick={ext.onFind}>Find… (Ctrl+F)</MenuButton>
          <MenuButton onClick={ext.onReplace}>Find &amp; Replace… (Ctrl+H)</MenuButton>
          <MenuButton onClick={ext.onPastePlain}>Paste as plain text</MenuButton>
          <MenuButton onClick={() => ext.onCopyAs('plain')}>Copy as plain text</MenuButton>
          <MenuButton onClick={() => ext.onCopyAs('html')}>Copy as HTML</MenuButton>
          <MenuButton onClick={() => ext.onCopyAs('md')}>Copy as Markdown</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Auto-format</div>
          <MenuButton onClick={() => { const n = applySmartQuotes(editor); window.alert(n ? `Smart quotes applied (${n} text blocks updated).` : 'Nothing to convert.'); }}>
            <span className="flex items-center gap-1"><QuoteIcon className="w-3 h-3" /> Smart quotes &amp; em-dashes</span>
          </MenuButton>
          <MenuButton onClick={() => { const n = applyOutlineNumbering(editor); window.alert(n ? `Outline numbering applied to ${n} headings.` : 'No headings to number.'); }}>
            <span className="flex items-center gap-1"><ListTree className="w-3 h-3" /> Auto-number headings (1, 1.1…)</span>
          </MenuButton>
          <MenuButton onClick={() => { const n = clearOutlineNumbering(editor); window.alert(n ? `Cleared numbering from ${n} headings.` : 'No numbered headings found.'); }}>Clear heading numbering</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Editor navigation</div>
          <MenuButton onClick={() => selectAll(editor)}><span className="flex items-center gap-1"><TextSelect className="w-3 h-3" /> Select all</span></MenuButton>
          <MenuButton onClick={() => goToTop(editor)}><span className="flex items-center gap-1"><ChevronsUp className="w-3 h-3" /> Go to top</span></MenuButton>
          <MenuButton onClick={() => goToBottom(editor)}><span className="flex items-center gap-1"><ChevronsDown className="w-3 h-3" /> Go to bottom</span></MenuButton>
        </ToolbarMenu>

        {/* Convert: text <-> list conversions */}
        <ToolbarMenu label="Convert" icon={ListTree} width={220}>
          <MenuButton onClick={() => doTextToList(false)}>Selected lines → bullet list</MenuButton>
          <MenuButton onClick={() => doTextToList(true)}>Selected lines → numbered list</MenuButton>
          <MenuButton onClick={doListToText}>List → plain paragraphs</MenuButton>
          <div className="text-[9px] text-rmpg-600 px-2 pt-1 leading-snug">Select multiple lines for text→list; click inside a list for list→text.</div>
        </ToolbarMenu>

        {/* Sort: list items / table rows */}
        <ToolbarMenu label="Sort" icon={ArrowDownUp} width={220}>
          <div className="text-[10px] text-rmpg-500 pb-0.5">List items</div>
          <MenuButton onClick={() => doSortList('asc')}>A → Z</MenuButton>
          <MenuButton onClick={() => doSortList('desc')}>Z → A</MenuButton>
          <MenuButton onClick={() => doSortList('numAsc')}>Numeric ↑</MenuButton>
          <MenuButton onClick={() => doSortList('numDesc')}>Numeric ↓</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1 pb-0.5">Table rows (by 1st column)</div>
          <MenuButton onClick={() => doSortTable('asc')}>A → Z</MenuButton>
          <MenuButton onClick={() => doSortTable('desc')}>Z → A</MenuButton>
          <MenuButton onClick={() => doSortTable('numAsc')}>Numeric ↑</MenuButton>
          <MenuButton onClick={() => doSortTable('numDesc')}>Numeric ↓</MenuButton>
        </ToolbarMenu>

        {/* Sections: reusable multi-paragraph report blocks */}
        <ToolbarMenu label="Sections" icon={Layers} width={240}>
          {(close) => (
            <>
              {Object.entries(sectionGroups).map(([group, items]) => (
                <div key={group} className="space-y-0.5">
                  <div className="text-[10px] text-rmpg-500 uppercase tracking-wide pt-1">{group}</div>
                  {items.map((b) => (
                    <MenuButton key={b.id} onClick={() => { addSection(b); close(); }}>{b.label}</MenuButton>
                  ))}
                </div>
              ))}
            </>
          )}
        </ToolbarMenu>

        {/* Table operations (features 51–70) */}
        <ToolbarMenu label="Table" icon={Grid3x3} width={210}>
          <MenuButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Insert 3×3 table</MenuButton>
          {inTable ? (
            <>
              <MenuButton onClick={() => editor.chain().focus().addRowBefore().run()}>Row above</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().addRowAfter().run()}>Row below</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().addColumnBefore().run()}>Column left</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().addColumnAfter().run()}>Column right</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().mergeCells().run()}>Merge cells</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().splitCell().run()}>Split cell</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</MenuButton>
              <MenuButton onClick={() => editor.chain().focus().toggleHeaderColumn().run()}>Toggle header column</MenuButton>
              <MenuRow label="Cell shading"><input type="color" onChange={(e) => editor.chain().focus().setCellAttribute('backgroundColor', e.target.value).run()} /></MenuRow>
              <MenuButton onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</MenuButton>
            </>
          ) : <div className="text-[10px] text-rmpg-600 italic px-2">Click inside a table for row/column tools.</div>}
        </ToolbarMenu>

        {/* List styles (features 86–97) */}
        <ToolbarMenu label="Lists" icon={ListOrdered} width={220}>
          <MenuButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>Bullet list</MenuButton>
          <MenuButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>Numbered list</MenuButton>
          <MenuButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>Checklist</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>Indent (nest)</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().liftListItem('listItem').run()}>Outdent</MenuButton>
          <MenuRow label="Bullet style">
            <select className={selCls} defaultValue="" onChange={(e) => editor.chain().focus().setListStyleType(e.target.value).run()}>
              {['disc', 'circle', 'square', 'none'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Number style">
            <select className={selCls} defaultValue="" onChange={(e) => editor.chain().focus().setListStyleType(e.target.value).run()}>
              {['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Marker color"><input type="color" onChange={(e) => editor.chain().focus().setListMarkerColor(e.target.value).run()} /></MenuRow>
          <MenuRow label="Start at">
            <input type="number" min={1} className={`${selCls} w-14`} defaultValue={1} onChange={(e) => editor.chain().focus().setListStart(Number(e.target.value) || 1).run()} />
          </MenuRow>
        </ToolbarMenu>

        {/* Review menu — comments + snapshots (features 101–110, 14, 17) */}
        <ToolbarMenu label="Review" icon={MessageSquare} width={210}>
          <MenuButton onClick={ext.onAddComment}>Add comment to selection</MenuButton>
          <MenuButton onClick={ext.onToggleComments}>Toggle comments panel</MenuButton>
          <MenuButton onClick={ext.onToggleAnalysis}><span className="flex items-center gap-1"><Gauge className="w-3 h-3" /> Analysis (readability/style/words/diff)</span></MenuButton>
          <MenuButton active={ext.brushActive} onClick={ext.onBrush}><span className="flex items-center gap-1"><Paintbrush className="w-3 h-3" /> Format brush {ext.brushActive ? '(armed)' : ''}</span></MenuButton>
          <MenuButton onClick={ext.onSnapshot}>Quick save version snapshot</MenuButton>
          <MenuButton onClick={ext.onToggleSnapshots}><span className="flex items-center gap-1"><Camera className="w-3 h-3" /> Snapshots panel…</span></MenuButton>
          <MenuButton onClick={ext.onOpenProperties}><span className="flex items-center gap-1"><Info className="w-3 h-3" /> Document properties…</span></MenuButton>
          <MenuButton onClick={ext.onToggleOutline}>Toggle outline pane</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Document language</div>
          <select className={`${selCls} w-full`} value={ext.language} onChange={(e) => ext.setLanguage(e.target.value)}>
            {[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </ToolbarMenu>

        {/* Assist menu — mail-merge, proofread, sections, track changes,
            minimap, redaction, autocomplete, appearance (this wave). */}
        <ToolbarMenu label="Assist" icon={Wrench} width={240}>
          <MenuButton onClick={ext.onToggleMerge}><span className="flex items-center gap-1"><Merge className="w-3 h-3" /> Mail-merge from CFS call…</span></MenuButton>
          <MenuButton onClick={ext.onToggleProofread}><span className="flex items-center gap-1"><SpellCheck2 className="w-3 h-3" /> Proofread (click-to-fix)</span></MenuButton>
          <MenuButton onClick={ext.onToggleSections}><span className="flex items-center gap-1"><ListChecks className="w-3 h-3" /> Section word counts &amp; goals</span></MenuButton>
          <MenuButton onClick={ext.onToggleTrackChanges}><span className="flex items-center gap-1"><GitPullRequestArrow className="w-3 h-3" /> Track changes…</span></MenuButton>
          <MenuButton active={ext.suggestMode} onClick={ext.onToggleSuggestMode}>Suggestion mode: {ext.suggestMode ? 'On' : 'Off'}</MenuButton>
          <MenuButton onClick={ext.onToggleMinimap}><span className="flex items-center gap-1"><MapIcon className="w-3 h-3" /> Document minimap</span></MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Selection</div>
          <MenuButton onClick={ext.onToggleRedaction}><span className="flex items-center gap-1"><SquareSlash className="w-3 h-3" /> Redact / un-redact selection</span></MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Writing environment</div>
          <MenuButton active={ext.autocompleteOn} onClick={ext.onToggleAutocomplete}><span className="flex items-center gap-1"><Lightbulb className="w-3 h-3" /> Phrase autocomplete: {ext.autocompleteOn ? 'On' : 'Off'}</span></MenuButton>
          <MenuButton onClick={ext.onOpenAppearance}><span className="flex items-center gap-1"><Sliders className="w-3 h-3" /> Editor appearance…</span></MenuButton>
        </ToolbarMenu>

        {/* View menu — zoom + reading/fullscreen (features 178–185, 50) */}
        <ToolbarMenu label="View" icon={Eye} width={200}>
          <MenuButton onClick={() => ext.setZoom(() => 1)}>Zoom 100%</MenuButton>
          <MenuButton onClick={() => ext.setZoom(() => 0.75)}>Fit width (75%)</MenuButton>
          <MenuButton onClick={() => ext.setZoom(() => 0.6)}>Fit page (60%)</MenuButton>
          <MenuButton active={ext.viewMode === 'reading'} onClick={() => ext.setViewMode(ext.viewMode === 'reading' ? 'normal' : 'reading')}>Reading mode</MenuButton>
          <MenuButton active={ext.viewMode === 'focus'} onClick={() => ext.setViewMode(ext.viewMode === 'focus' ? 'normal' : 'focus')}>Focus / Zen mode</MenuButton>
          <MenuButton active={ext.viewMode === 'fullscreen'} onClick={() => ext.setViewMode(ext.viewMode === 'fullscreen' ? 'normal' : 'fullscreen')}>Full screen</MenuButton>
          <MenuButton onClick={ext.onToggleOutline}>Navigation / outline</MenuButton>
        </ToolbarMenu>

        {/* Export menu (features 126–140) */}
        <ToolbarMenu label="Export" icon={FileDown} width={200}>
          <MenuButton onClick={onExportPdf}>PDF (print)</MenuButton>
          <MenuButton onClick={() => ext.onExport('html')}>HTML (raw fragment)</MenuButton>
          <MenuButton onClick={ext.onExportStandaloneHtml}><span className="flex items-center gap-1"><FileCode2 className="w-3 h-3" /> HTML (styled standalone)</span></MenuButton>
          <MenuButton onClick={() => ext.onExport('md')}>Markdown</MenuButton>
          <MenuButton onClick={() => ext.onExport('txt')}>Plain text</MenuButton>
          <MenuButton onClick={() => ext.onExport('rtf')}>RTF (Word)</MenuButton>
          <MenuButton onClick={ext.onEmail}>Email document…</MenuButton>
          <div className="text-[10px] text-rmpg-500 pt-1">Editor document (JSON)</div>
          <MenuButton onClick={ext.onExportJson}>Export as JSON…</MenuButton>
          <MenuButton onClick={ext.onImportJson}>Import from JSON…</MenuButton>
        </ToolbarMenu>

        {/* Design / layout menu (31–36, 40–42) */}
        <ToolbarMenu label="Design" icon={LayoutPanelTop} width={280}>
          <MenuRow label="Page size">
            <select className={selCls} value={docSettings.page.size} onChange={(e) => setPage({ size: e.target.value as DocSettings['page']['size'] })}>
              {['letter', 'legal', 'a4', 'a3'].map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}
            </select>
          </MenuRow>
          <MenuRow label="Orientation">
            <select className={selCls} value={docSettings.page.orientation} onChange={(e) => setPage({ orientation: e.target.value as 'portrait' | 'landscape' })}>
              <option value="portrait">Portrait</option><option value="landscape">Landscape</option>
            </select>
          </MenuRow>
          <div className="text-[10px] text-rmpg-500 pt-1">Margins (px)</div>
          <div className="grid grid-cols-2 gap-1">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <label key={side} className="flex items-center gap-1 text-[10px] text-rmpg-400">
                {side[0].toUpperCase()}
                <input type="number" className={`${selCls} w-14`} value={docSettings.page.margins[side]} onChange={(e) => setMargin(side, Number(e.target.value) || 0)} />
              </label>
            ))}
          </div>
          <MenuButton active={docSettings.header.enabled} onClick={() => setDocSettings((s) => ({ ...s, header: { ...s.header, enabled: !s.header.enabled } }))}>Header: {docSettings.header.enabled ? 'On' : 'Off'}</MenuButton>
          {docSettings.header.enabled && (
            <>
              <input className={`${selCls} w-full`} placeholder="Header text" value={docSettings.header.text} onChange={(e) => setDocSettings((s) => ({ ...s, header: { ...s.header, text: e.target.value } }))} />
              <MenuButton active={docSettings.header.showPageNumber} onClick={() => setDocSettings((s) => ({ ...s, header: { ...s.header, showPageNumber: !s.header.showPageNumber } }))}>Page number: {docSettings.header.showPageNumber ? 'On' : 'Off'}</MenuButton>
            </>
          )}
          <MenuButton active={docSettings.footer.enabled} onClick={() => setDocSettings((s) => ({ ...s, footer: { ...s.footer, enabled: !s.footer.enabled } }))}>Footer: {docSettings.footer.enabled ? 'On' : 'Off'}</MenuButton>
          {docSettings.footer.enabled && (
            <>
              <input className={`${selCls} w-full`} placeholder="Footer text" value={docSettings.footer.text} onChange={(e) => setDocSettings((s) => ({ ...s, footer: { ...s.footer, text: e.target.value } }))} />
              <MenuButton active={docSettings.footer.showDate} onClick={() => setDocSettings((s) => ({ ...s, footer: { ...s.footer, showDate: !s.footer.showDate } }))}>Date: {docSettings.footer.showDate ? 'On' : 'Off'}</MenuButton>
              <MenuButton active={docSettings.footer.showAuthor} onClick={() => setDocSettings((s) => ({ ...s, footer: { ...s.footer, showAuthor: !s.footer.showAuthor } }))}>Author: {docSettings.footer.showAuthor ? 'On' : 'Off'}</MenuButton>
            </>
          )}
          <MenuRow label="Watermark">
            <input className={`${selCls} w-28`} placeholder="text" value={docSettings.watermark.text} onChange={(e) => setDocSettings((s) => ({ ...s, watermark: { ...s.watermark, text: e.target.value } }))} />
          </MenuRow>
          <MenuButton active={docSettings.pageBorder} onClick={() => setDocSettings((s) => ({ ...s, pageBorder: !s.pageBorder }))}>Page border: {docSettings.pageBorder ? 'On' : 'Off'}</MenuButton>
          {docSettings.pageBorder && (
            <MenuRow label="Border style">
              <select className={selCls} value={docSettings.pageBorderStyle || 'thin'} onChange={(e) => setDocSettings((s) => ({ ...s, pageBorderStyle: e.target.value as DocSettings['pageBorderStyle'] }))}>
                {[['thin', 'Thin'], ['thick', 'Thick'], ['double', 'Double'], ['gold', 'Gold']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </MenuRow>
          )}
          <MenuButton active={!!docSettings.letterhead} onClick={() => setDocSettings((s) => ({ ...s, letterhead: !s.letterhead }))}>Letterhead band (print): {docSettings.letterhead ? 'On' : 'Off'}</MenuButton>
          <MenuRow label="Background">
            <input type="color" value={docSettings.background} onChange={(e) => setDocSettings((s) => ({ ...s, background: e.target.value }))} />
          </MenuRow>
          <MenuButton onClick={onInsertBackgroundImage}>Background image…</MenuButton>
          {docSettings.backgroundImage && <MenuButton onClick={() => setDocSettings((s) => ({ ...s, backgroundImage: null }))}>Remove background image</MenuButton>}
        </ToolbarMenu>

        {/* Templates (48/49) */}
        <ToolbarMenu label="Templates" icon={BookTemplate} width={220}>
          {(close) => (
            <>
              <MenuButton onClick={() => { const name = window.prompt('Template name:'); if (name) { saveTemplate(name, editor.getHTML()); close(); } }}>Save current as template…</MenuButton>
              <div className="text-[10px] text-rmpg-500 pt-1">Saved templates</div>
              {listSavedTemplates().length === 0 && <div className="text-[10px] text-rmpg-600 italic px-2">None yet</div>}
              {listSavedTemplates().map((t) => (
                <div key={t.name} className="flex items-center gap-1">
                  <MenuButton onClick={() => { editor.chain().focus().setContent(t.html).run(); close(); }}>{t.name}</MenuButton>
                  <button type="button" className="text-[10px] text-red-400/70 hover:text-red-300 px-1" title="Delete template" onClick={() => { deleteTemplate(t.name); close(); }}>✕</button>
                </div>
              ))}
            </>
          )}
        </ToolbarMenu>

        {/* Document menu — duplicate, recent docs, manual draft save */}
        <ToolbarMenu label="Doc" icon={FileStack} width={220}>
          <MenuButton onClick={ext.onSaveDraftNow}><span className="flex items-center gap-1"><Save className="w-3 h-3" /> Save draft now (local)</span></MenuButton>
          <MenuButton onClick={ext.onDuplicate}><span className="flex items-center gap-1"><Copy className="w-3 h-3" /> Duplicate / New from current</span></MenuButton>
          <MenuButton onClick={ext.onToggleRecent}><span className="flex items-center gap-1"><FileStack className="w-3 h-3" /> Recent documents…</span></MenuButton>
        </ToolbarMenu>

        {/* Statistics (50) */}
        <ToolbarMenu label={`${stats.words}w`} icon={BarChart3} width={200}>
          <MenuRow label="Words"><span className="text-[11px] text-rmpg-100">{stats.words}</span></MenuRow>
          <MenuRow label="Characters"><span className="text-[11px] text-rmpg-100">{stats.characters}</span></MenuRow>
          <MenuRow label="Chars (no spaces)"><span className="text-[11px] text-rmpg-100">{stats.charactersNoSpaces}</span></MenuRow>
          <MenuRow label="Sentences"><span className="text-[11px] text-rmpg-100">{stats.sentences}</span></MenuRow>
          <MenuRow label="Paragraphs"><span className="text-[11px] text-rmpg-100">{stats.paragraphs}</span></MenuRow>
          <MenuRow label="Pages (est.)"><span className="text-[11px] text-rmpg-100">{stats.pages}</span></MenuRow>
          <MenuRow label="Avg words/sentence"><span className="text-[11px] text-rmpg-100">{stats.avgWordsPerSentence}</span></MenuRow>
          <MenuRow label="Reading time"><span className="text-[11px] text-rmpg-100">{stats.readingMinutes} min</span></MenuRow>
        </ToolbarMenu>
      </div>
    </div>
  );
}
