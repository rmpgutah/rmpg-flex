// ============================================================
// DocumentIntakeReviewer — review and commit OCR-extracted fields
// ============================================================
// Stateless display + small-state form. Receives a
// DocumentExtraction envelope from /api/document-intake/extract
// and lets the user (a) verify each field with confidence colors,
// (b) edit values inline, (c) save to the matching destination
// record (warrant / FI today; "Download JSON" for unmapped kinds).

import { useMemo, useState } from 'react';
import { Check, Download, RotateCcw, Save, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import { getSaveBuilder, hasSaveHandler } from '../utils/documentIntakeSaveHandlers';

export interface ExtractedField {
  key: string;
  value: string;
  confidence: number;
  matchedAnchor?: string;
}

export interface DocumentExtraction {
  kind: string;
  tier: 'implemented' | 'stub';
  fields: ExtractedField[];
  confidence: number;
  pageCount: number;
  usedOcr: boolean;
  rawTextPreview: string;
  courtCategory?: string | null;
  state?: string | null;
}

interface Props {
  extraction: DocumentExtraction;
  /** Reset the page back to the upload state. */
  onReset: () => void;
}

const CONFIDENCE_THRESHOLDS = { high: 0.8, mid: 0.5 };

function confidenceColor(c: number): { dot: string; bg: string; label: string } {
  if (c >= CONFIDENCE_THRESHOLDS.high) return { dot: '#10b981', bg: 'rgba(16,185,129,0.08)', label: 'high' };
  if (c >= CONFIDENCE_THRESHOLDS.mid) return { dot: '#eab308', bg: 'rgba(234,179,8,0.08)', label: 'medium' };
  if (c > 0) return { dot: '#ef4444', bg: 'rgba(239,68,68,0.08)', label: 'low' };
  return { dot: '#555', bg: 'transparent', label: 'not found' };
}

export default function DocumentIntakeReviewer({ extraction, onReset }: Props) {
  const toast = useToast();
  // Local edits start as a copy of the OCR'd values; users can
  // revise before saving. Reset-to-OCR per row supported.
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(extraction.fields.map((f) => [f.key, f.value])),
  );
  const [saving, setSaving] = useState(false);

  const ocrByKey = useMemo(
    () => Object.fromEntries(extraction.fields.map((f) => [f.key, f.value])),
    [extraction.fields],
  );

  const canSaveDirect = hasSaveHandler(extraction.kind);
  const summaryColor = confidenceColor(extraction.confidence);

  async function handleSave() {
    const builder = getSaveBuilder(extraction.kind);
    if (!builder) return;
    const { endpoint, payload, label } = builder(edits);
    setSaving(true);
    try {
      const resp = await apiFetch<any>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const newId = resp?.id ?? resp?.data?.id;
      toast.addToast(`${label} saved${newId ? ` (#${newId})` : ''}`, 'success');
      onReset();
    } catch (err: any) {
      toast.addToast(`Save failed: ${err?.message || 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleDownloadJson() {
    const blob = new Blob(
      [JSON.stringify({ kind: extraction.kind, fields: edits, meta: {
        tier: extraction.tier,
        confidence: extraction.confidence,
        pageCount: extraction.pageCount,
        usedOcr: extraction.usedOcr,
        courtCategory: extraction.courtCategory,
        state: extraction.state,
      } }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intake-${extraction.kind}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="bg-[#141414] border border-[#222] p-3 panel-beveled" style={{ borderRadius: 2 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase text-[#888]">Detected Kind</div>
            <div className="text-[15px] font-semibold text-[#d4a017]">{extraction.kind}</div>
          </div>
          <div className="border-l border-[#222] pl-3">
            <div className="text-[10px] uppercase text-[#888]">Tier</div>
            <div className="text-[12px] font-mono">
              {extraction.tier === 'implemented'
                ? <span style={{ color: '#10b981' }}>● implemented</span>
                : <span style={{ color: '#eab308' }}>● stub (low coverage)</span>}
            </div>
          </div>
          <div className="border-l border-[#222] pl-3">
            <div className="text-[10px] uppercase text-[#888]">Confidence</div>
            <div className="text-[12px]" style={{ color: summaryColor.dot }}>
              {(extraction.confidence * 100).toFixed(0)}% — {summaryColor.label}
            </div>
          </div>
          <div className="border-l border-[#222] pl-3">
            <div className="text-[10px] uppercase text-[#888]">Pages</div>
            <div className="text-[12px]">{extraction.pageCount}</div>
          </div>
          <div className="border-l border-[#222] pl-3">
            <div className="text-[10px] uppercase text-[#888]">OCR</div>
            <div className="text-[12px]">{extraction.usedOcr ? 'fallback ran' : 'born-digital'}</div>
          </div>
          {extraction.courtCategory && (
            <div className="border-l border-[#222] pl-3">
              <div className="text-[10px] uppercase text-[#888]">Court Category</div>
              <div className="text-[12px]">{extraction.courtCategory}</div>
            </div>
          )}
        </div>
      </div>

      {/* Field list */}
      <div className="bg-[#141414] border border-[#222] panel-beveled" style={{ borderRadius: 2 }}>
        <div className="px-3 py-2 border-b border-[#222] text-[10px] uppercase font-semibold text-[#888] flex justify-between">
          <span>Extracted Fields ({extraction.fields.length})</span>
          <span className="text-[#666]">edit anything before saving · click ↺ to reset to OCR value</span>
        </div>
        <div className="divide-y divide-[#222]">
          {extraction.fields.map((f) => {
            const c = confidenceColor(f.confidence);
            const original = ocrByKey[f.key] ?? '';
            const dirty = edits[f.key] !== original;
            return (
              <div key={f.key} className="grid grid-cols-12 gap-2 px-3 py-2 items-center" style={{ background: c.bg }}>
                <div className="col-span-3">
                  <div className="text-[11px] font-semibold uppercase text-[#ccc]">
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: c.dot }} />
                    {f.matchedAnchor || f.key}
                  </div>
                  <div className="text-[9px] text-[#666] font-mono mt-0.5">{f.key}</div>
                </div>
                <div className="col-span-7">
                  <input
                    type="text"
                    value={edits[f.key] ?? ''}
                    onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] px-2 py-1 text-[11px] text-white"
                    style={{ borderRadius: 2 }}
                    placeholder={f.confidence === 0 ? '(not found in PDF — fill in manually)' : ''}
                  />
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <span className="text-[10px] font-mono" style={{ color: c.dot }}>
                    {f.confidence > 0 ? `${(f.confidence * 100).toFixed(0)}%` : '—'}
                  </span>
                  {dirty && (
                    <button
                      type="button"
                      onClick={() => setEdits({ ...edits, [f.key]: original })}
                      title="Reset to OCR value"
                      className="text-[#888] hover:text-[#d4a017]"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action bar */}
      <div className="bg-[#141414] border border-[#222] p-3 panel-beveled flex items-center gap-2 flex-wrap" style={{ borderRadius: 2 }}>
        {canSaveDirect ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-[11px] font-semibold uppercase border border-[#d4a017] text-[#d4a017] hover:bg-[#d4a017] hover:text-black disabled:opacity-50 flex items-center gap-1.5"
            style={{ borderRadius: 2 }}
          >
            {saving ? <Save className="w-3.5 h-3.5 animate-pulse" /> : <Check className="w-3.5 h-3.5" />}
            Save to Records as {extraction.kind}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-[#eab308]">
            <AlertTriangle className="w-3.5 h-3.5" />
            No direct save handler for "{extraction.kind}" yet — use Download JSON below
          </div>
        )}
        <button
          type="button"
          onClick={handleDownloadJson}
          className="px-3 py-1.5 text-[11px] uppercase border border-[#444] text-[#ccc] hover:bg-[#222] flex items-center gap-1.5"
          style={{ borderRadius: 2 }}
        >
          <Download className="w-3.5 h-3.5" /> Download JSON
        </button>
        <button
          type="button"
          onClick={onReset}
          className="ml-auto px-3 py-1.5 text-[11px] uppercase border border-[#444] text-[#888] hover:text-white"
          style={{ borderRadius: 2 }}
        >
          Upload Another
        </button>
      </div>

      {/* Raw text preview (collapsed by default) */}
      <details className="bg-[#0a0a0a] border border-[#222] panel-beveled" style={{ borderRadius: 2 }}>
        <summary className="px-3 py-2 cursor-pointer text-[10px] uppercase text-[#888]">
          Raw OCR text preview ({extraction.rawTextPreview.length.toLocaleString()} chars)
        </summary>
        <pre className="p-3 text-[10px] font-mono text-[#888] whitespace-pre-wrap max-h-[300px] overflow-auto">
          {extraction.rawTextPreview}
        </pre>
      </details>
    </div>
  );
}
