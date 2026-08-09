import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authedImageUrl } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';

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

export default function TesseractTrainingPage() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [groundTruth, setGroundTruth] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
