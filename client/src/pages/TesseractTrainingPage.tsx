import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { imageToNaturalCoords } from '../utils/tesseractImageCoords';

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
  raw_text: string | null;
  already_in_corpus: boolean;
  approval_status: 'pending' | 'approved' | null;
}

interface BoxAnnotation {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  corrected_text: string;
}

interface Stroke { tool: 'arrow' | 'circle' | 'highlight'; points: [number, number][]; color: string }

type Mode = 'text' | 'boxes' | 'notes';

interface StatsByDocType { doc_type: string | null; eligible: number; labeled: number; approved: number }
interface Stats { total_eligible: number; total_labeled: number; total_approved: number; by_doc_type: StatsByDocType[] }

export default function TesseractTrainingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterDocType, setFilterDocType] = useState(searchParams.get('doc_type') ?? '');
  const [filterLabeled, setFilterLabeled] = useState(searchParams.get('labeled') ?? '');
  const [filterFrom, setFilterFrom] = useState(searchParams.get('from') ?? '');
  const [filterTo, setFilterTo] = useState(searchParams.get('to') ?? '');
  const [rows, setRows] = useState<DocRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResultSummary, setBulkResultSummary] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('text');

  const [boxes, setBoxes] = useState<BoxAnnotation[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pendingBoxText, setPendingBoxText] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [activeTool, setActiveTool] = useState<Stroke['tool']>('highlight');
  const [drawingStroke, setDrawingStroke] = useState<Stroke | null>(null);
  const [notesDirty, setNotesDirty] = useState(false);

  const [stats, setStats] = useState<Stats | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);

  const loadStats = useCallback(() => {
    apiFetch<Stats>('/tesseract-training/stats').then(setStats).catch(console.error);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const loadList = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (filterDocType) params.set('doc_type', filterDocType);
    if (filterLabeled) params.set('labeled', filterLabeled);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?${params.toString()}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
    setSearchParams(params, { replace: true });
  }, [page, filterDocType, filterLabeled, filterFrom, filterTo, setSearchParams]);

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
    setBulkResultSummary(null);
    try {
      const res = await apiFetch<{ results: Array<{ id: number; success: boolean; error?: string }> }>(
        '/tesseract-training/documents/bulk-submit',
        { method: 'POST', body: JSON.stringify({ document_ids: Array.from(selectedIds) }) },
      );
      const succeeded = res.results.filter((r) => r.success).length;
      const failed = res.results.length - succeeded;
      setBulkResultSummary(`${succeeded} submitted, ${failed} failed`);
      setSelectedIds(new Set());
      loadList();
      loadStats();
    } catch (err) {
      setBulkResultSummary(err instanceof Error ? err.message : 'Bulk submit failed');
    } finally {
      setBulkSubmitting(false);
    }
  };

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    apiFetch<DocDetail>(`/tesseract-training/documents/${selectedId}`)
      .then((d) => { setDetail(d); setGroundTruth(d.raw_text ?? ''); setSubmitError(null); })
      .catch(console.error);
  }, [selectedId]);

  const loadBoxes = useCallback(() => {
    if (selectedId == null) return;
    apiFetch<{ boxes: BoxAnnotation[] }>(`/tesseract-training/documents/${selectedId}/boxes`)
      .then((res) => setBoxes(res.boxes))
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'boxes') loadBoxes(); }, [mode, loadBoxes]);

  const loadNotes = useCallback(() => {
    if (selectedId == null) return;
    apiFetch<{ strokes: Stroke[] | null }>(`/tesseract-training/documents/${selectedId}/notes`)
      .then((res) => { setStrokes(res.strokes ?? []); setNotesDirty(false); })
      .catch(console.error);
  }, [selectedId]);

  useEffect(() => { if (mode === 'notes') loadNotes(); }, [mode, loadNotes]);

  const handleSubmit = async () => {
    if (selectedId == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetch(`/tesseract-training/documents/${selectedId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ ground_truth_text: groundTruth }),
      });
      setSelectedId(null);
      loadList();
      loadStats();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
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
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
    setDrawStart(p);
    setDrawRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawStart || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
    setDrawRect({
      x0: Math.min(drawStart.x, p.x), y0: Math.min(drawStart.y, p.y),
      x1: Math.max(drawStart.x, p.x), y1: Math.max(drawStart.y, p.y),
    });
  };

  const handleCanvasPointerUp = () => {
    setDrawStart(null);
    // drawRect stays set — the inline text input below the image commits it.
  };

  const commitBox = async () => {
    if (!drawRect || selectedId == null || !pendingBoxText.trim()) return;
    await apiFetch(`/tesseract-training/documents/${selectedId}/boxes`, {
      method: 'POST',
      body: JSON.stringify({ ...drawRect, corrected_text: pendingBoxText.trim() }),
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

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="TESSERACT TRAINING SETUP" />
      {stats && (
        <div className="border border-surface-border p-3 space-y-2">
          <button
            onClick={() => setStatsOpen((v) => !v)}
            className="text-[11px] font-bold uppercase tracking-wide"
          >
            Coverage {statsOpen ? '▲' : '▼'}
          </button>
          {statsOpen && (
            <div className="space-y-1 text-[11px]">
              <p>
                {stats.total_labeled} / {stats.total_eligible} documents labeled
                ({stats.total_approved} approved)
              </p>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th>Doc Type</th><th>Eligible</th><th>Labeled</th><th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_doc_type.map((row) => (
                    <tr key={row.doc_type ?? '(none)'}>
                      <td>{row.doc_type ?? '(unclassified)'}</td>
                      <td>{row.eligible}</td>
                      <td>{row.labeled}</td>
                      <td>{row.approved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-4">
        <div className="w-1/3 space-y-2">
          <div className="space-y-1 pb-2 border-b border-surface-border">
            <select
              value={filterDocType}
              onChange={(e) => { setFilterDocType(e.target.value); setPage(1); }}
              className="w-full text-[11px] border p-1"
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
              onChange={(e) => { setFilterLabeled(e.target.value); setPage(1); }}
              className="w-full text-[11px] border p-1"
            >
              <option value="">Labeled + unlabeled</option>
              <option value="true">Labeled only</option>
              <option value="false">Unlabeled only</option>
            </select>
            <div className="flex gap-1">
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                className="flex-1 text-[11px] border p-1"
              />
              <input
                type="date"
                value={filterTo}
                onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                className="flex-1 text-[11px] border p-1"
              />
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedIds.has(r.id)}
                onChange={() => toggleSelected(r.id)}
                disabled={r.already_in_corpus}
                aria-label={`Select ${r.file_name} for bulk submit`}
              />
              <button
                onClick={() => setSelectedId(r.id)}
                className={`flex-1 text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
              >
                {r.file_name}
                {r.approval_status === 'approved' && ' [APPROVED]'}
                {r.approval_status === 'pending' && ' [PENDING]'}
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
          {selectedIds.size > 0 && (
            <div className="space-y-1">
              <button onClick={handleBulkSubmit} disabled={bulkSubmitting} className="px-3 py-1 border w-full">
                Submit {selectedIds.size} Selected
              </button>
              {bulkResultSummary && <p className="text-[11px]">{bulkResultSummary}</p>}
            </div>
          )}
        </div>
        <div className="w-2/3">
          {detail && (
            <div className="space-y-2">
              <div className="flex gap-2 border-b border-surface-border">
                {(['text', 'boxes', 'notes'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1 text-[11px] uppercase ${mode === m ? 'border-b-2 border-brand-400 text-brand-300' : 'text-fg-muted'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {mode === 'text' && (
                <>
                  <img
                    src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                    alt={detail.file_name}
                    className="max-w-full border"
                  />
                  <textarea
                    value={groundTruth}
                    onChange={(e) => setGroundTruth(e.target.value)}
                    rows={12}
                    className="w-full border p-2 text-[11px] font-mono"
                  />
                  {submitError && <p className="text-[11px] text-red-500">{submitError}</p>}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || detail.already_in_corpus}
                    className="px-3 py-1 border"
                  >
                    {detail.already_in_corpus ? 'Already Submitted' : 'Submit to Training Corpus'}
                  </button>
                  {detail.already_in_corpus && detail.approval_status === 'pending' && (
                    <button
                      onClick={handleApprove}
                      disabled={approving}
                      className="px-3 py-1 border ml-2"
                    >
                      Approve
                    </button>
                  )}
                </>
              )}

              {mode === 'boxes' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-fg-muted">
                    Drag a box over a word or line, then type its correct text below.
                    These boxes become real Tesseract training data.
                  </p>
                  <div
                    className="relative inline-block"
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                  >
                    <img
                      ref={imgRef}
                      src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                      alt={detail.file_name}
                      className="max-w-full border block"
                    />
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {boxes.map((b) => (
                        <rect
                          key={b.id}
                          x={`${(b.x0 / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          y={`${(b.y0 / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          width={`${((b.x1 - b.x0) / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          height={`${((b.y1 - b.y0) / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          fill="none" stroke="lime" strokeWidth={2}
                        />
                      ))}
                      {drawRect && (
                        <rect
                          x={`${(drawRect.x0 / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          y={`${(drawRect.y0 / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          width={`${((drawRect.x1 - drawRect.x0) / (imgRef.current?.naturalWidth || 1)) * 100}%`}
                          height={`${((drawRect.y1 - drawRect.y0) / (imgRef.current?.naturalHeight || 1)) * 100}%`}
                          fill="none" stroke="yellow" strokeWidth={2}
                        />
                      )}
                    </svg>
                  </div>
                  {drawRect && (
                    <div className="flex gap-2">
                      <input
                        value={pendingBoxText}
                        onChange={(e) => setPendingBoxText(e.target.value)}
                        placeholder="Correct text for this region"
                        className="flex-1 border p-1 text-[11px]"
                      />
                      <button onClick={commitBox} className="px-3 py-1 border">Save Box</button>
                      <button onClick={() => { setDrawRect(null); setPendingBoxText(''); }} className="px-3 py-1 border">Cancel</button>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {boxes.map((b) => (
                      <li key={b.id} className="flex justify-between text-[11px] border p-1">
                        <span>{b.corrected_text}</span>
                        <button onClick={() => deleteBox(b.id)} className="text-red-500">Delete</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {mode === 'notes' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-fg-muted">
                    Free-form marks for human reviewers only — never used for training.
                  </p>
                  <div className="flex gap-2">
                    {(['highlight', 'circle', 'arrow'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setActiveTool(t)}
                        className={`px-2 py-1 text-[11px] border ${activeTool === t ? 'bg-surface-raised' : ''}`}
                      >
                        {t}
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        if (selectedId == null) return;
                        await apiFetch(`/tesseract-training/documents/${selectedId}/notes`, {
                          method: 'PUT',
                          body: JSON.stringify({ strokes }),
                        });
                        setNotesDirty(false);
                      }}
                      disabled={!notesDirty}
                      className="px-2 py-1 text-[11px] border ml-auto"
                    >
                      Save Notes
                    </button>
                  </div>
                  <div
                    className="relative inline-block"
                    onPointerDown={(e) => {
                      if (!imgRef.current) return;
                      const rect = imgRef.current.getBoundingClientRect();
                      const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
                      setDrawingStroke({ tool: activeTool, points: [[p.x, p.y]], color: '#f59e0b' });
                    }}
                    onPointerMove={(e) => {
                      if (!drawingStroke || !imgRef.current) return;
                      const rect = imgRef.current.getBoundingClientRect();
                      const p = imageToNaturalCoords(rect, imgRef.current.naturalWidth, imgRef.current.naturalHeight, { x: e.clientX, y: e.clientY });
                      setDrawingStroke({ ...drawingStroke, points: [...drawingStroke.points, [p.x, p.y]] });
                    }}
                    onPointerUp={() => {
                      if (drawingStroke) {
                        setStrokes((prev) => [...prev, drawingStroke]);
                        setNotesDirty(true);
                      }
                      setDrawingStroke(null);
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={authedImageUrl(`/api/tesseract-training/documents/${detail.id}/image`)}
                      alt={detail.file_name}
                      className="max-w-full border block"
                    />
                    <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                      {[...strokes, ...(drawingStroke ? [drawingStroke] : [])].map((s, i) => (
                        <polyline
                          key={i}
                          points={s.points.map(([x, y]) => `${(x / (imgRef.current?.naturalWidth || 1)) * 100}%,${(y / (imgRef.current?.naturalHeight || 1)) * 100}%`).join(' ')}
                          fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round"
                        />
                      ))}
                    </svg>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
