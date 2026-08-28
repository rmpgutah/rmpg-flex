import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  BarChart2,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Clock,
  Download,
  Package,
  FileText,
  Box,
  PenLine,
  Highlighter,
  Circle,
  ArrowRight,
  Trash2,
  Loader2,
  Save,
  Send,
  Filter,
  Square,
  CheckSquare,
  AlertTriangle,
  X,
} from 'lucide-react';
import { apiFetch, apiFetchBlob, apiPostForm, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import TrainingDocumentViewer, { type TrainingViewerSize } from '../components/tesseract/TrainingDocumentViewer';
import { useToast } from '../components/ToastProvider';
import { imageToNaturalCoords } from '../utils/tesseractImageCoords';
import { formatDateTime } from '../utils/dateUtils';
import {
  parseTrainingSearchParams,
  trainingFiltersToSearchParams,
  trainingListQueryString,
} from '../utils/tesseractTrainingFilters';
import {
  appendStrokePoint,
  arrowHead,
  ellipseFromPoints,
  pct as strokePct,
  type NoteStroke,
  type NoteTool,
} from '../utils/tesseractNoteStrokes';
import { isPdfBytes } from '../utils/tesseractDocMime';
import { rasterizePdfPagesForTraining } from '../utils/tesseractPdfRaster';

interface DocRow {
  id: number;
  file_name: string;
  doc_type: string | null;
  created_at: string;
  already_in_corpus: boolean;
  approval_status: 'pending' | 'approved' | null;
}

interface DocDetail {
  id: number;
  file_name: string;
  file_type: string | null;
  raw_text: string | null;
  already_in_corpus: boolean;
  approval_status: 'pending' | 'approved' | null;
}

interface BoxAnnotation {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  corrected_text: string;
  page_number?: number;
}

type Mode = 'text' | 'boxes' | 'notes';

interface StatsByDocType { doc_type: string | null; eligible: number; labeled: number; approved: number }
interface Stats { total_eligible: number; total_labeled: number; total_approved: number; by_doc_type: StatsByDocType[] }

interface TrainingRun {
  id: number;
  generated_at: string;
  generated_by: number;
  document_count: number;
}

const LIST_PAGE_SIZE = 50;

const TOOL_ICONS = {
  highlight: Highlighter,
  circle: Circle,
  arrow: ArrowRight,
} as const;

const TOOL_COLORS: Record<NoteTool, string> = {
  highlight: 'rgba(245,158,11,0.55)',
  circle: 'rgba(59,130,246,0.80)',
  arrow: 'rgba(239,68,68,0.90)',
};

export default function TesseractTrainingPage() {
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = parseTrainingSearchParams(searchParams);

  const filterDocType = parsed.docType;
  const filterLabeled = parsed.labeled;
  const filterFrom = parsed.from;
  const filterTo = parsed.to;
  const page = parsed.page;

  const setFilter = (patch: Partial<{ docType: string; labeled: string; from: string; to: string; page: number; selected: string }>) => {
    const next = {
      page: patch.page ?? (patch.docType !== undefined || patch.labeled !== undefined || patch.from !== undefined || patch.to !== undefined ? 1 : page),
      docType: patch.docType ?? filterDocType,
      labeled: patch.labeled ?? filterLabeled,
      from: patch.from ?? filterFrom,
      to: patch.to ?? filterTo,
      selected: patch.selected !== undefined ? patch.selected : parsed.selected,
    };
    setSearchParams(trainingFiltersToSearchParams(next), { replace: true });
  };

  const [rows, setRows] = useState<DocRow[]>([]);
  const selectedId = parsed.selected ? parseInt(parsed.selected, 10) : null;
  const setSelectedId = (id: number | null) => setFilter({ selected: id == null ? '' : String(id) });

  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [mode, setMode] = useState<Mode>('text');
  const [docPage, setDocPage] = useState(1);
  const [viewerSize, setViewerSize] = useState<TrainingViewerSize>({ naturalWidth: 1, naturalHeight: 1, pageCount: 1 });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [boxes, setBoxes] = useState<BoxAnnotation[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pendingBoxText, setPendingBoxText] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);

  const [strokes, setStrokes] = useState<NoteStroke[]>([]);
  const [activeTool, setActiveTool] = useState<NoteTool>('highlight');
  const [drawingStroke, setDrawingStroke] = useState<NoteStroke | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsOpen, setStatsOpen] = useState(true);

  const [runs, setRuns] = useState<TrainingRun[]>([]);
  const [startingRun, setStartingRun] = useState(false);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    apiFetch<Stats>('/tesseract-training/stats')
      .then(setStats)
      .catch(console.error)
      .finally(() => setStatsLoading(false));
  }, []);

  const loadRuns = useCallback(() => {
    apiFetch<{ rows: TrainingRun[] }>('/tesseract-training/documents/runs?page=1')
      .then((res) => setRuns(res.rows))
      .catch(console.error);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const handleStartRun = async () => {
    setStartingRun(true);
    try {
      await apiFetch('/tesseract-training/documents/runs', { method: 'POST' });
      loadRuns();
      loadStats();
      addToast('Training package built successfully.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to build training package', 'error');
    } finally {
      setStartingRun(false);
    }
  };

  const loadList = useCallback(() => {
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?${trainingListQueryString({
      page, docType: filterDocType, labeled: filterLabeled, from: filterFrom, to: filterTo,
    })}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
  }, [page, filterDocType, filterLabeled, filterFrom, filterTo]);

  useEffect(() => { loadList(); }, [loadList]);

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkSubmit = async () => {
    if (selectedIds.size === 0) return;
    setBulkSubmitting(true);
    try {
      const res = await apiFetch<{ results: Array<{ id: number; success: boolean; error?: string }> }>(
        '/tesseract-training/documents/bulk-submit',
        { method: 'POST', body: JSON.stringify({ document_ids: Array.from(selectedIds) }) },
      );
      const succeeded = res.results.filter((r) => r.success).length;
      const failed = res.results.length - succeeded;
      addToast(`${succeeded} submitted${failed > 0 ? `, ${failed} failed` : ''}.`, failed > 0 ? 'error' : 'success');
      setSelectedIds(new Set());
      loadList();
      loadStats();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk submit failed', 'error');
    } finally {
      setBulkSubmitting(false);
    }
  };

  useEffect(() => {
    setDocPage(1);
    setDrawRect(null);
    setPendingBoxText('');
    setDrawingStroke(null);
    if (selectedId == null || Number.isNaN(selectedId)) { setDetail(null); return; }
    apiFetch<DocDetail>(`/tesseract-training/documents/${selectedId}`)
      .then((d) => { setDetail(d); setGroundTruth(d.raw_text ?? ''); })
      .catch(console.error);
  }, [selectedId]);

  const loadBoxes = useCallback(() => {
    if (selectedId == null || Number.isNaN(selectedId)) return;
    apiFetch<{ boxes: BoxAnnotation[] }>(`/tesseract-training/documents/${selectedId}/boxes`)
      .then((res) => setBoxes(res.boxes))
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'boxes') loadBoxes(); }, [mode, loadBoxes]);

  const loadNotes = useCallback(() => {
    if (selectedId == null || Number.isNaN(selectedId)) return;
    apiFetch<{ strokes: NoteStroke[] | null }>(`/tesseract-training/documents/${selectedId}/notes`)
      .then((res) => { setStrokes(res.strokes ?? []); setNotesDirty(false); })
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'notes') loadNotes(); }, [mode, loadNotes]);

  const uploadRasterPages = async (id: number, fileType: string | null) => {
    const blob = await apiFetchBlob(`/tesseract-training/documents/${id}/image`);
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (!isPdfBytes(buf, blob.type || fileType)) return;
    const pages = await rasterizePdfPagesForTraining(buf);
    if (pages.length === 0) return;
    const fd = new FormData();
    for (const p of pages) {
      fd.append('page', p.file);
      fd.append('page_number', String(p.pageNumber));
    }
    await apiPostForm(`/tesseract-training/documents/${id}/raster-pages`, fd);
  };

  const handleSubmit = async () => {
    if (selectedId == null) return;
    setSubmitting(true);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ ground_truth_text: groundTruth }),
      });
      try {
        await uploadRasterPages(selectedId, detail?.file_type ?? null);
      } catch (rasterErr) {
        addToast(rasterErr instanceof Error ? rasterErr.message : 'Submitted, but page images failed to upload', 'error');
      }
      addToast('Submitted to training corpus.', 'success');
      const d = await apiFetch<DocDetail>(`/tesseract-training/documents/${selectedId}`);
      setDetail(d);
      loadList();
      loadStats();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (selectedId == null) return;
    setApproving(true);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/approve`, { method: 'POST' });
      setDetail((d) => (d ? { ...d, approval_status: 'approved' } : d));
      loadList();
      loadStats();
      addToast('Document approved for training.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Approval failed', 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleSaveNotes = async () => {
    if (selectedId == null) return;
    setSavingNotes(true);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/notes`, {
        method: 'PUT',
        body: JSON.stringify({ strokes }),
      });
      setNotesDirty(false);
      addToast('Notes saved.', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const pointerToNatural = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgRef.current) return null;
    const rect = imgRef.current.getBoundingClientRect();
    return imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'boxes') return;
    const p = pointerToNatural(e);
    if (!p) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    setDrawStart(p);
    setDrawRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === 'boxes') {
      if (!drawStart) return;
      const p = pointerToNatural(e);
      if (!p) return;
      setDrawRect({
        x0: Math.min(drawStart.x, p.x), y0: Math.min(drawStart.y, p.y),
        x1: Math.max(drawStart.x, p.x), y1: Math.max(drawStart.y, p.y),
      });
      return;
    }
    if (mode === 'notes' && drawingStroke) {
      const p = pointerToNatural(e);
      if (!p) return;
      setDrawingStroke(appendStrokePoint(drawingStroke, p));
    }
  };

  const handleCanvasPointerUp = () => { setDrawStart(null); };

  const handleNotesPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'notes') return;
    const p = pointerToNatural(e);
    if (!p) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    setDrawingStroke({ tool: activeTool, points: [[p.x, p.y]], color: TOOL_COLORS[activeTool], page: docPage });
  };

  const handleNotesPointerUp = () => {
    if (drawingStroke) { setStrokes((prev) => [...prev, drawingStroke]); setNotesDirty(true); }
    setDrawingStroke(null);
  };

  const commitBox = async () => {
    if (!drawRect || selectedId == null || !pendingBoxText.trim()) return;
    await apiFetch(`/tesseract-training/documents/${selectedId}/boxes`, {
      method: 'POST',
      body: JSON.stringify({ ...drawRect, corrected_text: pendingBoxText.trim(), page_number: docPage }),
    });
    setDrawRect(null);
    setPendingBoxText('');
    loadBoxes();
  };

  const deleteBox = async (boxId: number) => {
    if (selectedId == null) return;
    await apiFetch(`/tesseract-training/documents/${selectedId}/boxes/${boxId}`, { method: 'DELETE' });
    loadBoxes();
  };

  const pct = (v: number, total: number) => total > 0 ? Math.round((v / total) * 100) : 0;
  const natW = viewerSize.naturalWidth || 1;
  const natH = viewerSize.naturalHeight || 1;
  const pageBoxes = boxes.filter((b) => (b.page_number ?? 1) === docPage);
  const pageStrokes = [...strokes.filter((s) => (s.page ?? 1) === docPage), ...(drawingStroke ? [drawingStroke] : [])];

  const overlay = (mode === 'boxes' || mode === 'notes') ? (
    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
      {mode === 'boxes' && pageBoxes.map((b) => (
        <rect key={b.id}
          x={`${strokePct(b.x0, natW)}%`}
          y={`${strokePct(b.y0, natH)}%`}
          width={`${strokePct(b.x1 - b.x0, natW)}%`}
          height={`${strokePct(b.y1 - b.y0, natH)}%`}
          fill="none" stroke="rgba(34,197,94,0.8)" strokeWidth={2}
        />
      ))}
      {mode === 'boxes' && drawRect && (
        <rect
          x={`${strokePct(drawRect.x0, natW)}%`}
          y={`${strokePct(drawRect.y0, natH)}%`}
          width={`${strokePct(drawRect.x1 - drawRect.x0, natW)}%`}
          height={`${strokePct(drawRect.y1 - drawRect.y0, natH)}%`}
          fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth={2} strokeDasharray="4 2"
        />
      )}
      {mode === 'notes' && pageStrokes.map((s, i) => {
        if (s.tool === 'circle' && s.points.length >= 2) {
          const e = ellipseFromPoints(s.points[0], s.points[s.points.length - 1]);
          return (
            <ellipse key={i}
              cx={`${strokePct(e.cx, natW)}%`} cy={`${strokePct(e.cy, natH)}%`}
              rx={`${strokePct(e.rx, natW)}%`} ry={`${strokePct(e.ry, natH)}%`}
              fill="none" stroke={s.color} strokeWidth={3}
            />
          );
        }
        if (s.tool === 'arrow' && s.points.length >= 2) {
          const from = s.points[0];
          const to = s.points[s.points.length - 1];
          const head = arrowHead(from, to);
          return (
            <g key={i}>
              <line
                x1={`${strokePct(from[0], natW)}%`} y1={`${strokePct(from[1], natH)}%`}
                x2={`${strokePct(to[0], natW)}%`} y2={`${strokePct(to[1], natH)}%`}
                stroke={s.color} strokeWidth={3} strokeLinecap="round"
              />
              <polygon
                points={head.map(([x, y]) => `${strokePct(x, natW)}%,${strokePct(y, natH)}%`).join(' ')}
                fill={s.color}
              />
            </g>
          );
        }
        return (
          <polyline
            key={i}
            points={s.points.map(([x, y]) => `${strokePct(x, natW)}%,${strokePct(y, natH)}%`).join(' ')}
            fill="none" stroke={s.color} strokeWidth={s.tool === 'highlight' ? 12 : 3}
            strokeOpacity={s.tool === 'highlight' ? 0.45 : 1}
            strokeLinecap="round" strokeLinejoin="round"
          />
        );
      })}
    </svg>
  ) : null;

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="TESSERACT OCR TRAINING" icon={Package} />

      <div className="bg-surface-raised border border-border-default rounded-sm">
        <button
          onClick={() => setStatsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[color:var(--panel-header-color)]"
        >
          <span className="flex items-center gap-1.5"><BarChart2 size={11} /> Coverage Dashboard</span>
          {statsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {statsOpen && statsLoading && (
          <div className="px-3 py-3 border-t border-border-subtle flex items-center gap-2 text-[10px] text-fg-muted">
            <Loader2 size={11} className="animate-spin" /> Loading coverage data…
          </div>
        )}
        {statsOpen && !statsLoading && !stats && (
          <div className="px-3 py-3 border-t border-border-subtle text-[10px] text-amber-400 flex items-center gap-2">
            <AlertTriangle size={11} /> Could not load coverage stats.
          </div>
        )}
        {statsOpen && stats && stats.total_eligible === 0 && (
          <div className="px-3 py-3 border-t border-border-subtle text-[10px] text-fg-muted italic">
            No extracted documents found. Process serve documents first to populate training data.
          </div>
        )}
        {statsOpen && stats && stats.total_eligible > 0 && (
          <div className="px-3 pb-3 space-y-2 border-t border-border-subtle">
            <div className="grid grid-cols-3 gap-2 pt-2">
              {[
                { label: 'Eligible', value: stats.total_eligible },
                { label: 'Labeled',  value: stats.total_labeled,  sub: `${pct(stats.total_labeled, stats.total_eligible)}%` },
                { label: 'Approved', value: stats.total_approved, sub: `${pct(stats.total_approved, stats.total_eligible)}%`, highlight: true },
              ].map(({ label, value, sub, highlight }) => (
                <div key={label} className="bg-surface-base border border-border-subtle rounded-sm px-2 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-[color:var(--field-label-color)]">{label}</p>
                  <p className={`text-[18px] font-bold leading-none ${highlight ? 'text-green-400' : 'text-rmpg-100'}`}>{value}</p>
                  {sub && <p className="text-[9px] text-fg-muted mt-0.5">{sub}</p>}
                </div>
              ))}
            </div>

            <div className="w-full bg-surface-base rounded-sm h-1.5 overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${pct(stats.total_approved, stats.total_eligible)}%` }}
              />
            </div>

            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left py-1 text-[color:var(--field-label-color)] font-semibold">Doc Type</th>
                  <th className="text-right py-1 text-fg-muted font-semibold">Eligible</th>
                  <th className="text-right py-1 text-fg-muted font-semibold">Labeled</th>
                  <th className="text-right py-1 text-fg-muted font-semibold">Approved</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_doc_type.map((row) => (
                  <tr key={row.doc_type ?? '__none__'} className="border-b border-border-subtle last:border-0">
                    <td className="py-[3px] text-rmpg-200">{row.doc_type ?? <span className="text-fg-muted italic">unclassified</span>}</td>
                    <td className="py-[3px] text-right text-fg-secondary">{row.eligible}</td>
                    <td className="py-[3px] text-right text-fg-secondary">{row.labeled}</td>
                    <td className="py-[3px] text-right text-green-400 font-semibold">{row.approved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-surface-raised border border-border-default rounded-sm">
        <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--panel-header-color)] flex items-center gap-1.5">
            <Package size={11} /> Training Runs
          </span>
          <button
            onClick={handleStartRun}
            disabled={startingRun || !stats || stats.total_approved === 0}
            title={stats && stats.total_approved === 0 ? 'Approve at least one document first' : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 rounded-sm text-[10px] font-bold text-white"
          >
            {startingRun ? <><Loader2 size={11} className="animate-spin" /> Building…</> : <><Package size={11} /> Build Package</>}
          </button>
        </div>

        {stats && stats.total_approved === 0 && (
          <div className="px-3 py-2 flex items-center gap-2 text-[10px] text-amber-400 border-b border-border-subtle">
            <AlertTriangle size={11} /> Approve at least one document before building a training package.
          </div>
        )}

        {runs.length === 0 ? (
          <p className="px-3 py-3 text-[10px] text-fg-muted italic">No training runs yet.</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left px-3 py-1.5 text-[color:var(--field-label-color)] font-semibold">Generated</th>
                <th className="text-right px-3 py-1.5 text-fg-muted font-semibold">Docs</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-hover">
                  <td className="px-3 py-[3px] text-rmpg-200">{formatDateTime(run.generated_at)}</td>
                  <td className="px-3 py-[3px] text-right text-fg-secondary">{run.document_count}</td>
                  <td className="px-3 py-[3px] text-right">
                    <a
                      href={authedImageUrl(`/api/tesseract-training/documents/runs/${run.id}/download`)}
                      download={`rmpg-training-${run.id}.zip`}
                      className="inline-flex items-center gap-1 text-brand-300 hover:text-brand-100"
                    >
                      <Download size={11} /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex gap-3 min-h-0">
        <div className="w-72 flex-none bg-surface-raised border border-border-default rounded-sm flex flex-col">
          <div className="p-2 space-y-1.5 border-b border-border-default">
            <div className="flex items-center gap-1 text-[9px] text-fg-muted uppercase tracking-wider pb-0.5">
              <Filter size={9} /> Filters
            </div>
            <select
              value={filterDocType}
              onChange={(e) => setFilter({ docType: e.target.value })}
              className="w-full text-[10px] border border-border-default bg-surface-base text-rmpg-200 px-1.5 py-1 rounded-sm appearance-none"
            >
              <option value="">All doc types</option>
              <option value="null">(unclassified)</option>
              {stats?.by_doc_type
                .filter((r) => r.doc_type != null)
                .map((r) => (
                  <option key={r.doc_type} value={r.doc_type!}>{r.doc_type}</option>
                ))}
            </select>
            <select
              value={filterLabeled}
              onChange={(e) => setFilter({ labeled: e.target.value })}
              className="w-full text-[10px] border border-border-default bg-surface-base text-rmpg-200 px-1.5 py-1 rounded-sm appearance-none"
            >
              <option value="">Labeled + unlabeled</option>
              <option value="true">Labeled only</option>
              <option value="false">Unlabeled only</option>
            </select>
            <div className="flex gap-1">
              <input type="date" value={filterFrom} onChange={(e) => setFilter({ from: e.target.value })}
                className="flex-1 text-[10px] border border-border-default bg-surface-base text-rmpg-200 px-1.5 py-1 rounded-sm appearance-none" />
              <input type="date" value={filterTo} onChange={(e) => setFilter({ to: e.target.value })}
                className="flex-1 text-[10px] border border-border-default bg-surface-base text-rmpg-200 px-1.5 py-1 rounded-sm appearance-none" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-border-subtle">
            {rows.length === 0 && (
              <p className="px-2 py-3 text-[10px] text-fg-muted italic">No documents match these filters.</p>
            )}
            {rows.map((r) => {
              const isSelected = selectedId === r.id;
              const isChecked = selectedIds.has(r.id);
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group ${isSelected ? 'bg-brand-900/40' : 'hover:bg-surface-hover'}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); if (!r.already_in_corpus) toggleSelected(r.id); }}
                    disabled={r.already_in_corpus}
                    className="flex-none text-fg-muted disabled:opacity-30"
                    aria-label={`Select ${r.file_name} for bulk submit`}
                  >
                    {isChecked ? <CheckSquare size={13} className="text-brand-400" /> : <Square size={13} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[10px] truncate ${isSelected ? 'text-rmpg-100' : 'text-rmpg-200'}`}>{r.file_name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {r.doc_type && <span className="text-[8px] text-fg-muted">{r.doc_type}</span>}
                      {r.approval_status === 'approved' && (
                        <span className="text-[8px] font-bold px-1 bg-green-900/40 text-green-400 border border-green-700/50 flex items-center gap-0.5">
                          <CheckCircle size={8} /> APPROVED
                        </span>
                      )}
                      {r.approval_status === 'pending' && (
                        <span className="text-[8px] font-bold px-1 bg-amber-900/30 text-amber-400 border border-amber-700/40 flex items-center gap-0.5">
                          <Clock size={8} /> PENDING
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-2 border-t border-border-default space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <button onClick={() => setFilter({ page: Math.max(1, page - 1) })} disabled={page === 1}
                className="px-2 py-0.5 border border-border-default text-fg-secondary disabled:opacity-30 hover:text-rmpg-100">← Prev</button>
              <span className="text-fg-muted">Page {page}</span>
              <button onClick={() => setFilter({ page: page + 1 })} disabled={rows.length < LIST_PAGE_SIZE}
                className="px-2 py-0.5 border border-border-default text-fg-secondary disabled:opacity-30 hover:text-rmpg-100">Next →</button>
            </div>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkSubmit}
                disabled={bulkSubmitting}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-40 text-[10px] font-bold text-white rounded-sm"
              >
                {bulkSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                Submit {selectedIds.size} Selected
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-surface-raised border border-border-default rounded-sm flex flex-col">
          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-[11px] text-fg-muted italic">
              Select a document to review
            </div>
          ) : (
            <>
              <div className="flex items-center border-b border-border-default px-2 gap-1">
                {([
                  { id: 'text'  as Mode, label: 'Text Correction', icon: FileText },
                  { id: 'boxes' as Mode, label: 'Box Annotations', icon: Box },
                  { id: 'notes' as Mode, label: 'Review Notes',    icon: PenLine },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={`flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                      mode === id
                        ? 'border-brand-400 text-brand-300'
                        : 'border-transparent text-fg-muted hover:text-fg-secondary'
                    }`}
                  >
                    <Icon size={11} /> {label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1 px-2 py-1.5">
                  {detail.approval_status === 'approved' && (
                    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-green-900/40 text-green-400 border border-green-700/50">
                      <CheckCircle size={9} /> APPROVED
                    </span>
                  )}
                  {detail.approval_status === 'pending' && (
                    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 bg-amber-900/30 text-amber-400 border border-amber-700/40">
                      <Clock size={9} /> PENDING APPROVAL
                    </span>
                  )}
                  <button
                    onClick={() => setSelectedId(null)}
                    className="ml-1 text-fg-muted hover:text-rmpg-200"
                    aria-label="Close document"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {mode === 'boxes' && (
                  <p className="text-[10px] text-fg-secondary">
                    Drag a box over a word or line, then enter its correct text. These become Tesseract training data.
                  </p>
                )}
                {mode === 'notes' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] uppercase tracking-wider text-fg-muted">Tool:</span>
                    {(['highlight', 'circle', 'arrow'] as const).map((t) => {
                      const Icon = TOOL_ICONS[t];
                      return (
                        <button
                          key={t}
                          onClick={() => setActiveTool(t)}
                          className={`flex items-center gap-1 px-2 py-1 text-[10px] border rounded-sm ${
                            activeTool === t
                              ? 'border-brand-400 bg-brand-900/40 text-brand-300'
                              : 'border-border-default text-fg-secondary hover:text-rmpg-200'
                          }`}
                        >
                          <Icon size={11} /> {t}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => { setStrokes([]); setNotesDirty(true); }}
                      disabled={strokes.length === 0}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] border border-border-default text-fg-muted hover:text-red-400 disabled:opacity-30 rounded-sm ml-1"
                    >
                      <Trash2 size={11} /> Clear
                    </button>
                    <button
                      onClick={handleSaveNotes}
                      disabled={!notesDirty || savingNotes}
                      className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-[10px] font-bold text-white rounded-sm ml-auto"
                    >
                      {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      Save Notes
                    </button>
                  </div>
                )}
                {mode === 'notes' && (
                  <p className="text-[10px] text-fg-muted">
                    Free-form marks for human reviewers only — not used for training.
                  </p>
                )}

                <TrainingDocumentViewer
                  documentId={detail.id}
                  fileType={detail.file_type}
                  fileName={detail.file_name}
                  page={docPage}
                  onPageChange={setDocPage}
                  onSize={setViewerSize}
                  imgRef={imgRef}
                  cursorClass={mode === 'text' ? '' : 'cursor-crosshair'}
                  onPointerDown={mode === 'boxes' ? handleCanvasPointerDown : mode === 'notes' ? handleNotesPointerDown : undefined}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={mode === 'boxes' ? handleCanvasPointerUp : mode === 'notes' ? handleNotesPointerUp : undefined}
                >
                  {overlay}
                </TrainingDocumentViewer>

                {mode === 'text' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-[color:var(--field-label-color)] mb-1">
                        Ground-Truth Text
                      </label>
                      <textarea
                        value={groundTruth}
                        onChange={(e) => setGroundTruth(e.target.value)}
                        rows={12}
                        className="w-full border border-border-default bg-surface-base text-rmpg-100 text-[11px] font-mono p-2 rounded-sm"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {!detail.already_in_corpus ? (
                        <button
                          onClick={handleSubmit}
                          disabled={submitting}
                          className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-[10px] font-bold text-white rounded-sm"
                        >
                          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          Submit to Training Corpus
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-green-400">
                          <CheckCircle size={12} /> Already in corpus
                        </span>
                      )}
                      {detail.already_in_corpus && detail.approval_status === 'pending' && (
                        <button
                          onClick={handleApprove}
                          disabled={approving}
                          className="flex items-center gap-1.5 px-3 py-2 bg-green-800 hover:bg-green-700 disabled:opacity-40 text-[10px] font-bold text-white rounded-sm"
                        >
                          {approving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                          Approve for Training
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {mode === 'boxes' && drawRect && (
                  <div className="flex gap-2 items-center">
                    <input
                      autoFocus
                      value={pendingBoxText}
                      onChange={(e) => setPendingBoxText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitBox(); if (e.key === 'Escape') { setDrawRect(null); setPendingBoxText(''); } }}
                      placeholder="Correct text for this region…"
                      className="flex-1 border border-border-default bg-surface-base text-rmpg-100 text-[10px] px-2 py-1.5 rounded-sm"
                    />
                    <button onClick={commitBox} disabled={!pendingBoxText.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-[10px] font-bold text-white rounded-sm">
                      <Save size={11} /> Save
                    </button>
                    <button onClick={() => { setDrawRect(null); setPendingBoxText(''); }}
                      className="flex items-center gap-1 px-2 py-1.5 border border-border-default text-[10px] text-fg-secondary hover:text-rmpg-100 rounded-sm">
                      <X size={11} />
                    </button>
                  </div>
                )}

                {mode === 'boxes' && pageBoxes.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[9px] uppercase tracking-wider text-[color:var(--field-label-color)]">Saved Boxes ({pageBoxes.length})</p>
                    {pageBoxes.map((b) => (
                      <div key={b.id} className="flex items-center justify-between bg-surface-base border border-border-subtle px-2 py-1 rounded-sm">
                        <span className="text-[10px] text-rmpg-200 font-mono">{b.corrected_text}</span>
                        <button onClick={() => deleteBox(b.id)} className="text-fg-muted hover:text-red-400">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
