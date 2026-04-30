import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, FilePlus2, Sparkles, Clock } from 'lucide-react';

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
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [creatingBlank, setCreatingBlank] = useState(false);

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
      const { RmpgPdfBuilder } = await import('../../lib/rmpg-pdf-engine');
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
      const res = await fetch('/api/uploads', { method: 'POST', headers, body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const data = await res.json() as { files: Array<{ file_id: string; original_name: string }> };
      const created = data.files?.[0];
      if (!created) throw new Error('Upload returned no file');
      const params = new URLSearchParams({ fileId: created.file_id, name: created.original_name });
      if (currentFolderId != null) params.set('folderId', String(currentFolderId));
      navigate(`/pdf-editor?${params.toString()}`);
    } catch (err) {
      console.error('[apps-shelf] new blank PDF failed', err);
      alert(`Could not create blank PDF: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setCreatingBlank(false);
    }
  };

  const cardCls = 'group bg-[#0d0d0d] hover:bg-[#141414] border border-[#222] hover:border-[#d4a017]/40 rounded-[2px] p-3 transition-colors text-left flex items-start gap-2 min-w-[200px]';

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-[#d4a017]" />
        <span className="text-[10px] uppercase tracking-wider text-rmpg-400 font-semibold">Apps</span>
        <span className="text-[10px] text-rmpg-600">— integrated tools that operate on this folder</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={openEditor} className={cardCls}>
          <FileText className="w-5 h-5 text-[#d4a017] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-white font-semibold group-hover:text-[#d4a017]">PDF Editor</div>
            <div className="text-[10px] text-rmpg-500">View, annotate, redact, sign, encrypt — proprietary RMPG PDF Engine</div>
          </div>
        </button>
        <button type="button" onClick={createBlankPdf} disabled={creatingBlank} className={cardCls}>
          <FilePlus2 className="w-5 h-5 text-[#d4a017] flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-xs text-white font-semibold group-hover:text-[#d4a017]">{creatingBlank ? 'Creating…' : 'New blank PDF'}</div>
            <div className="text-[10px] text-rmpg-500">Single-page A4 — opens in the editor</div>
          </div>
        </button>
      </div>
      {recents.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px]">
          <Clock className="w-3 h-3 text-rmpg-500" />
          <span className="text-rmpg-500 uppercase tracking-wider">Recent:</span>
          {recents.map(r => (
            <button key={r.fileId} type="button"
              onClick={() => {
                const params = new URLSearchParams({ fileId: r.fileId, name: r.fileName });
                if (r.folderId != null) params.set('folderId', String(r.folderId));
                navigate(`/pdf-editor?${params.toString()}`);
              }}
              className="px-2 py-0.5 bg-[#0d0d0d] border border-[#222] hover:border-[#d4a017]/50 rounded-sm text-rmpg-300 hover:text-white truncate max-w-[200px]"
              title={r.fileName}>
              {r.fileName}
            </button>
          ))}
        </div>
      )}
    </div>
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
