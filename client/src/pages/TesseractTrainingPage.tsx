import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { imageToNaturalCoords } from '../utils/tesseractImageCoords';

interface DocRow {
  id: number;
  file_name: string;
  doc_type: string | null;
  created_at: string;
  already_in_corpus: boolean;
}

interface DocDetail {
  id: number;
  file_name: string;
  raw_text: string | null;
  already_in_corpus: boolean;
}

interface BoxAnnotation {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  corrected_text: string;
}

type Mode = 'text' | 'boxes' | 'notes';

export default function TesseractTrainingPage() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('text');

  const [boxes, setBoxes] = useState<BoxAnnotation[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [pendingBoxText, setPendingBoxText] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);

  const loadList = useCallback(() => {
    apiFetch<{ rows: DocRow[] }>(`/tesseract-training/documents?page=${page}`)
      .then((res) => setRows(res.rows))
      .catch(console.error);
  }, [page]);

  useEffect(() => { loadList(); }, [loadList]);

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
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
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
      <div className="flex gap-4">
        <div className="w-1/3 space-y-2">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`block w-full text-left p-2 text-[11px] border ${r.already_in_corpus ? 'opacity-50' : ''}`}
            >
              {r.file_name} {r.already_in_corpus ? '(already labeled)' : ''}
            </button>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
        <div className="w-2/3">
          {detail && (
            <div className="space-y-2">
              <div className="flex gap-2 border-b border-surface-border">
                {(['text', 'boxes', 'notes'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1 text-[11px] uppercase ${mode === m ? 'border-b-2 border-brand-400 text-brand-300' : 'text-rmpg-500'}`}
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
                </>
              )}

              {mode === 'boxes' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-rmpg-500">
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
                <p className="text-[11px] text-rmpg-500">Notes mode implemented in the next task.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
