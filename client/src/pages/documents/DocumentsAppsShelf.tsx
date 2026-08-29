import { useEffect, useState } from 'react';
import { apiFetch, uploadsUrl } from '../../hooks/useApi';
import { useNavigate } from 'react-router';
import { FileText, FilePlus2, FileCode, Sparkles, Clock, Eye } from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { useToast } from '../../components/ToastProvider';
import ConfirmDialog from '../../components/ConfirmDialog';
import { importWithRetry } from '../../utils/importWithRetry';

// Documents Apps shelf — a row of integrated applications that operate
// on the contents of the current folder. The PDF Editor is the first
// integrated app; the shelf is designed so future tools (image annotator,
// video reviewer, OCR scanner) can drop in alongside without restructuring
// the page.
//
// Behavior:
//   - "Open PDF Editor" launches /pdf-editor with the current folder pre-set
//     so saves go straight back into Documents in this folder.
//   - "New blank PDF" creates a single-page A4 blank PDF using the proprietary
//     RMPG PDF Engine writer, drops it into the current folder, and opens it
//     in the editor.
//   - Recent files (from the editor's localStorage) are surfaced as quick chips.

interface Props {
  currentFolderId: number | null;
}

interface RecentEntry {
  fileId: string;
  fileName: string;
  folderId: number | null;
  openedAt: number;
}

export default function DocumentsAppsShelf({ currentFolderId }: Props) {
  const navigate = useNavigate();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [creatingBlank, setCreatingBlank] = useState(false);
  const [creatingText, setCreatingText] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('notes.txt');
  const { addToast } = useToast();

  // Open a recent file in the PDF editor (shared by the chip onClick + its
  // right-click "Open" menu action).
  const openRecent = (r: RecentEntry) => {
    const params = new URLSearchParams({ fileId: r.fileId, name: r.fileName });
    if (r.folderId != null) params.set('folderId', String(r.folderId));
    navigate(`/pdf-editor?${params.toString()}`);
  };

  const buildRecentMenu = (r: RecentEntry): ContextMenuItem[] => [
    m.action('Open in editor', () => openRecent(r), { icon: <Eye size={12} /> }),
    m.separator(),
    m.copy('Copy file name', r.fileName),
    m.copyId(r.fileId, 'Copy file ID'),
  ];

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rmpg-pdf-editor-recent');
      if (raw) setRecents((JSON.parse(raw) as RecentEntry[]).slice(0, 5));
    } catch { /* ignore */ }
  }, []);

  const openEditor = () => {
    const params = new URLSearchParams();
    if (currentFolderId != null) params.set('folderId', String(currentFolderId));
    navigate(`/pdf-editor${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const createBlankPdf = async () => {
    setCreatingBlank(true);
    try {
      // Lazy import the proprietary writer so the shelf doesn't bloat the main bundle.
      const { RmpgPdfBuilder } = await importWithRetry(() => import('../../lib/rmpg-pdf-engine'));
      // Start from a tiny synthetic source: a one-page PDF with no contents.
      // We construct it inline so we can hand it to RmpgPdfBuilder.load().
      const synthetic = buildBlankSourceBytes();
      const builder = await RmpgPdfBuilder.load(synthetic);
      builder.setMetadata({ title: 'New document' });
      const bytes = await builder.save();
      const file = new File([bytes as BlobPart], `new-${Date.now()}.pdf`, { type: 'application/pdf' });
      const form = new FormData();
      form.append('files', file);
      if (currentFolderId != null) form.append('folder_id', String(currentFolderId));
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(uploadsUrl(), { method: 'POST', headers, body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json() as { files: Array<{ file_id: string; original_name: string }> };
      const created = data.files?.[0];
      if (!created) throw new Error('Upload returned no file');
      const params = new URLSearchParams({ fileId: created.file_id, name: created.original_name });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/pdf-editor?${params.toString()}`);
    } catch (err) {
      console.error('[apps-shelf] new blank PDF failed', err);
      addToast(`Could not create blank PDF: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
    } finally {
      setCreatingBlank(false);
    }
  };

  const createTextFile = async () => {
    setNameOpen(true);
    setNewFileName('notes.txt');
  };

  const confirmCreateTextFile = async () => {
    const name = newFileName.trim();
    if (!name) return;
    setNameOpen(false);
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
      csv: 'text/csv', json: 'application/json',
      xml: 'text/xml', html: 'text/html',
      js: 'text/javascript', ts: 'text/javascript',
      py: 'text/x-python', sh: 'text/x-sh', yaml: 'text/x-yaml', yml: 'text/x-yaml',
    };
    const mimeType = mimeMap[ext] || 'text/plain';
    setCreatingText(true);
    try {
      const created = await apiFetch<{ file_id: string; original_name: string }>('/uploads/create', {
        method: 'POST',
        body: JSON.stringify({ name, mime_type: mimeType, folder_id: currentFolderId }),
      });
      const params = new URLSearchParams({ fileId: created.file_id, name: created.original_name, mime: mimeType });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/text-editor?${params.toString()}`);
    } catch (err) {
      console.error('[apps-shelf] new text file failed', err);
      addToast(`Could not create file: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
    } finally {
      setCreatingText(false);
    }
  };

  const cardCls = 'group bg-surface-base hover:bg-surface-base border border-border-default hover:border-accent-gold-300/40 rounded-[2px] p-3 transition-colors text-left flex items-start gap-2 min-w-[200px]';

  return (
    <>
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-[color:var(--field-label-color)]" />
        <span className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">Apps</span>
        <span className="text-[10px] text-fg-muted">— integrated tools that operate on this folder</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={openEditor} className={cardCls}>
          <FileText className="w-5 h-5 text-[color:var(--field-label-color)] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rmpg-100 font-semibold group-hover:text-[color:var(--field-label-color)]">PDF Editor</div>
            <div className="text-[10px] text-fg-muted">View, annotate, redact, sign, encrypt — proprietary RMPG PDF Engine</div>
          </div>
        </button>
        <button type="button" onClick={createBlankPdf} disabled={creatingBlank} className={cardCls}>
          <FilePlus2 className="w-5 h-5 text-[color:var(--field-label-color)] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rmpg-100 font-semibold group-hover:text-[color:var(--field-label-color)]">{creatingBlank ? 'Creating…' : 'New blank PDF'}</div>
            <div className="text-[10px] text-fg-muted">Single-page A4 — opens in the editor</div>
          </div>
        </button>
        <button type="button" onClick={() => {
          const params = new URLSearchParams();
          if (currentFolderId != null) params.set('folderId', String(currentFolderId));
          navigate(`/document-writer${params.toString() ? `?${params.toString()}` : ''}`);
        }} className={cardCls}>
          <FileText className="w-5 h-5 text-[color:var(--field-label-color)] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rmpg-100 font-semibold group-hover:text-[color:var(--field-label-color)]">Document Writer</div>
            <div className="text-[10px] text-fg-muted">Reports, memos, forms — full word processor with templates</div>
          </div>
        </button>
        <button type="button" onClick={createTextFile} disabled={creatingText} className={cardCls}>
          <FileCode className="w-5 h-5 text-[color:var(--field-label-color)] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rmpg-100 font-semibold group-hover:text-[color:var(--field-label-color)]">{creatingText ? 'Creating…' : 'New Text File'}</div>
            <div className="text-[10px] text-fg-muted">Plain text, JSON, CSV, Markdown, code — in-app editor</div>
          </div>
        </button>
        <button type="button" onClick={() => navigate('/docs')} className={cardCls}>
          <FileText className="w-5 h-5 text-[color:var(--field-label-color)] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-rmpg-100 font-semibold group-hover:text-[color:var(--field-label-color)]">Documents Library</div>
            <div className="text-[10px] text-fg-muted">Authored narratives & reports — formatted, versioned, attachable to calls</div>
          </div>
        </button>
      </div>
      {recents.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px]">
          <Clock className="w-3 h-3 text-fg-muted" />
          <span className="text-fg-muted uppercase tracking-wider">Recent:</span>
          {recents.map(r => (
            <button key={r.fileId} type="button"
              onClick={() => openRecent(r)}
              onContextMenu={(e) => openMenu(e, buildRecentMenu(r))}
              className="px-2 py-0.5 bg-surface-base border border-border-default hover:border-accent-gold-300/50 rounded-sm text-fg-muted hover:text-rmpg-100 truncate max-w-[200px]"
              title={r.fileName}>
              {r.fileName}
            </button>
          ))}
        </div>
      )}
    </div>
    <ConfirmDialog
      isOpen={nameOpen}
      onClose={() => setNameOpen(false)}
      onConfirm={() => { void confirmCreateTextFile(); }}
      title="New text file"
      message="Name the file. Include an extension such as .txt, .md, or .json."
      confirmLabel="Create"
      confirmVariant="default"
      confirmDisabled={!newFileName.trim()}
      details={
        <input
          autoFocus
          type="text"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFileName.trim()) {
              e.preventDefault();
              void confirmCreateTextFile();
            }
          }}
          className="input-dark text-[12px] w-full mt-1"
          aria-label="New file name"
        />
      }
    />
    </>
  );
}

/** Build a minimal valid PDF (single blank A4 page) without any third-party
 *  library. Used as the seed for "New blank PDF" so the writer has a source
 *  to load + extend.
 *
 *  Important: this body must be **pure ASCII** so JS string length equals
 *  the encoded byte length, which is what the xref offsets index against.
 *  We skip the optional `%\xff\xff\xff\xff` binary marker — the writer's
 *  save() emits it on the actual output document; the seed doesn't need it.
 */
function buildBlankSourceBytes(): Uint8Array {
  const enc = new TextEncoder();
  const header = `%PDF-1.7\n`;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>\nendobj\n`;
  let body = '';
  const offsets: number[] = [];
  let cursor = header.length;
  for (const o of [obj1, obj2, obj3]) {
    offsets.push(cursor);
    body += o;
    cursor += o.length;
  }
  const xrefStart = cursor;
  let xref = `xref\n0 4\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return enc.encode(header + body + xref + trailer);
}
