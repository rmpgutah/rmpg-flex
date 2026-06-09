import { Editor } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, List, ListOrdered, Table as TableIcon, Image as ImageIcon,
  Undo2, Redo2, Heading1, Heading2, Heading3, Minus, Quote, Code, Superscript,
  Subscript, RemoveFormatting, CheckSquare, Link2, Printer, Download, Save, FileText,
  Type, Pilcrow, LayoutPanelTop, PlusSquare, Sun, Moon, BarChart3, BookTemplate,
  Baseline, PaintBucket,
} from 'lucide-react';
import ToolbarMenu, { MenuRow, MenuButton } from './ToolbarMenu';
import {
  insertTableOfContents, insertFootnote, insertEndnote, insertBookmark,
  insertCrossReference, insertCoverPage, insertField, insertMarginNote, insertTabStop,
  computeStats, listSavedTemplates, saveTemplate, deleteTemplate,
} from '../docActions';
import { FONT_FAMILIES, FONT_SIZES, type DocSettings, type WriterTheme } from '../types';

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
  saving, title, author, onTitleChange,
}: Props) {
  if (!editor) return null;

  const stats = computeStats(editor);
  const setBlock = (attrs: Record<string, string | null>) => editor.chain().focus().setBlockStyle(attrs).run();
  const setPage = (patch: Partial<DocSettings['page']>) => setDocSettings((s) => ({ ...s, page: { ...s.page, ...patch } }));
  const setMargin = (side: keyof DocSettings['page']['margins'], v: number) =>
    setDocSettings((s) => ({ ...s, page: { ...s.page, margins: { ...s.page.margins, [side]: v } } }));

  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-[2px] p-1.5">
      {/* Title row */}
      <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-[#1a1a1a]">
        <FileText className="w-4 h-4 text-[#d4a017]" />
        <input
          type="text" value={title} onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Document"
          className="flex-1 bg-transparent border-none text-sm text-rmpg-100 font-semibold focus:outline-none placeholder-rmpg-600"
        />
        <button type="button" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[#141414] border border-[#222] text-rmpg-300 rounded-[2px] hover:bg-[#1a1a1a]">
          {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
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
          <MenuButton active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}>Normal text</MenuButton>
          {[1, 2, 3, 4].map((lvl) => (
            <MenuButton key={lvl} active={editor.isActive('heading', { level: lvl })} onClick={() => editor.chain().focus().toggleHeading({ level: lvl as 1 | 2 | 3 | 4 }).run()}>Heading {lvl}</MenuButton>
          ))}
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
          <MenuButton onClick={onInsertImage}><span className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Image</span></MenuButton>
          <MenuButton onClick={() => { const url = window.prompt('URL:'); if (url) editor.chain().focus().setLink({ href: url }).run(); }}><span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> Link</span></MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setPageBreak().run()}>Page break</MenuButton>
          <MenuButton onClick={() => editor.chain().focus().setSectionBreak().run()}>Section break</MenuButton>
          <MenuButton onClick={() => insertTableOfContents(editor)}>Table of contents</MenuButton>
          <MenuButton onClick={() => insertFootnote(editor)}>Footnote</MenuButton>
          <MenuButton onClick={() => insertEndnote(editor)}>Endnote</MenuButton>
          <MenuButton onClick={() => insertCrossReference(editor)}>Cross-reference</MenuButton>
          <MenuButton onClick={() => insertBookmark(editor)}>Bookmark</MenuButton>
          <MenuButton onClick={() => insertMarginNote(editor)}>Margin note</MenuButton>
          <MenuButton onClick={() => insertCoverPage(editor, title, author)}>Cover page</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'page')}>Page-number field</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'date')}>Date field</MenuButton>
          <MenuButton onClick={() => insertField(editor, 'author', author)}>Author field</MenuButton>
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

        {/* Statistics (50) */}
        <ToolbarMenu label={`${stats.words}w`} icon={BarChart3} width={200}>
          <MenuRow label="Words"><span className="text-[11px] text-rmpg-100">{stats.words}</span></MenuRow>
          <MenuRow label="Characters"><span className="text-[11px] text-rmpg-100">{stats.characters}</span></MenuRow>
          <MenuRow label="Chars (no spaces)"><span className="text-[11px] text-rmpg-100">{stats.charactersNoSpaces}</span></MenuRow>
          <MenuRow label="Sentences"><span className="text-[11px] text-rmpg-100">{stats.sentences}</span></MenuRow>
          <MenuRow label="Paragraphs"><span className="text-[11px] text-rmpg-100">{stats.paragraphs}</span></MenuRow>
          <MenuRow label="Pages (est.)"><span className="text-[11px] text-rmpg-100">{stats.pages}</span></MenuRow>
          <MenuRow label="Reading time"><span className="text-[11px] text-rmpg-100">{stats.readingMinutes} min</span></MenuRow>
        </ToolbarMenu>
      </div>
    </div>
  );
}
