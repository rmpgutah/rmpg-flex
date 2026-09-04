// ============================================================
// DocumentIntakeReviewer — review and commit OCR-extracted fields
// ============================================================
// Stateless display + small-state form. Receives a
// DocumentExtraction envelope from /api/document-intake/extract
// and lets the user (a) verify each field with confidence colors,
// (b) edit values inline, (c) save to the matching destination
// record (warrant / FI today; "Download JSON" for unmapped kinds).
//
// Page 57 audit (v1075): theme-token sweep replaces inline hex,
// a ConfirmDialog now gates "Upload Another" when the clerk has
// pending edits (the old reset silently discarded them), and a
// new "Print Intake Report" emits the clerk-trail PDF via
// utils/documentIntakePdf.

import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  RotateCcw,
  Save,
  AlertTriangle,
  Printer,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from './ToastProvider';
import { getSaveBuilder, hasSaveHandler, requiresIncident } from '../utils/documentIntakeSaveHandlers';
import IncidentPicker, { type IncidentSummary } from './IncidentPicker';
import ConfirmDialog from './ConfirmDialog';
import { generateDocumentIntakePdf, suggestFilename } from '../utils/documentIntakePdf';
import { formatEnumValue } from '../utils/formatters';

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
  /** Source filename — printed on the intake report. Optional so
   *  legacy callers still compile, but the page always passes it. */
  filename?: string;
  /** Reset the page back to the upload state. */
  onReset: () => void;
}

const CONFIDENCE_THRESHOLDS = { high: 0.8, mid: 0.5 };

/** Confidence dots/backgrounds map to the theme's severity palette
 *  so they re-theme cleanly between night/day:
 *    high   confidence → sev-ok (green)    "the extraction is trustworthy"
 *    medium confidence → sev-warn (amber)  "double-check before saving"
 *    low    confidence → sev-critical (red) "almost certainly wrong"
 *  Each var has a hex fallback so a future theme that drops the
 *  severity tokens still renders something. */
function confidenceColor(c: number): { dot: string; bg: string; label: string } {
  if (c >= CONFIDENCE_THRESHOLDS.high) {
    return {
      dot: 'rgb(var(--sev-ok-rgb, 34 197 94))',
      bg: 'rgb(var(--sev-ok-rgb, 34 197 94) / 0.08)',
      label: 'high',
    };
  }
  if (c >= CONFIDENCE_THRESHOLDS.mid) {
    return {
      dot: 'rgb(var(--sev-warn-rgb, 245 158 11))',
      bg: 'rgb(var(--sev-warn-rgb, 245 158 11) / 0.08)',
      label: 'medium',
    };
  }
  if (c > 0) {
    return {
      dot: 'rgb(var(--sev-critical-rgb, 239 68 68))',
      bg: 'rgb(var(--sev-critical-rgb, 239 68 68) / 0.08)',
      label: 'low',
    };
  }
  return { dot: 'rgb(var(--rmpg-600-rgb))', bg: 'transparent', label: 'not found' };
}

export default function DocumentIntakeReviewer({ extraction, filename, onReset }: Props) {
  const toast = useToast();
  // Local edits start as a copy of the OCR'd values; users can
  // revise before saving. Reset-to-OCR per row supported.
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(extraction.fields.map((f) => [f.key, f.value])),
  );
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  const ocrByKey = useMemo(
    () => Object.fromEntries(extraction.fields.map((f) => [f.key, f.value])),
    [extraction.fields],
  );

  // Tracks whether the clerk has touched anything since the
  // extraction landed. Used to gate the destructive "Upload Another"
  // path through a ConfirmDialog so we don't silently drop edits.
  const isDirty = useMemo(
    () => extraction.fields.some((f) => (edits[f.key] ?? '') !== (ocrByKey[f.key] ?? '')),
    [edits, ocrByKey, extraction.fields],
  );

  const canSaveDirect = hasSaveHandler(extraction.kind);
  const needsIncident = requiresIncident(extraction.kind);
  const [selectedIncident, setSelectedIncident] = useState<IncidentSummary | null>(null);
  const summaryColor = confidenceColor(extraction.confidence);

  async function handleSave() {
    const builder = getSaveBuilder(extraction.kind);
    if (!builder) return;
    if (needsIncident && !selectedIncident) {
      toast.addToast('Pick an incident to attach this to before saving', 'warning');
      return;
    }
    setSaving(true);
    try {
      const ctx = selectedIncident
        ? { incidentId: selectedIncident.id, incidentNumber: selectedIncident.incident_number }
        : {};
      const { endpoint, payload, label } = builder(edits, ctx);
      const resp = await apiFetch<any>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const newId = resp?.id ?? resp?.data?.id;
      toast.addToast(`${label} saved${newId ? ` (#${newId})` : ''}`, 'success');
      onReset();
    } catch (err) {
      toast.addToast(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
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

  /** Emit the clerk-trail PDF for this extraction — same shape the
   *  on-screen reviewer shows (per-field confidence band + value +
   *  OCR original + raw-text preview), so a supervisor reviewing
   *  the intake queue or a discovery responder has a one-pager that
   *  documents what got pulled before it landed in records. */
  async function handlePrintPdf() {
    setPrintingPdf(true);
    try {
      const fields = extraction.fields.map((f) => ({
        key: f.key,
        value: edits[f.key] ?? '',
        confidence: f.confidence,
        matchedAnchor: f.matchedAnchor ?? null,
        originalValue: ocrByKey[f.key] ?? '',
      }));
      const doc = generateDocumentIntakePdf({
        filename: filename || `${extraction.kind}.pdf`,
        kind: extraction.kind,
        tier: extraction.tier,
        confidence: extraction.confidence,
        pageCount: extraction.pageCount,
        usedOcr: extraction.usedOcr,
        fields,
        rawTextPreview: extraction.rawTextPreview,
        courtCategory: extraction.courtCategory ?? null,
        state: extraction.state ?? null,
      });
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestFilename(extraction.kind, filename || extraction.kind);
      a.click();
      URL.revokeObjectURL(url);
      toast.addToast('Intake report PDF generated', 'success');
    } catch (err) {
      toast.addToast(`PDF generation failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setPrintingPdf(false);
    }
  }

  function handleRequestReset() {
    if (isDirty) {
      setConfirmReset(true);
      return;
    }
    onReset();
  }

  return (
    <div className="space-y-3">
      {/* Header summary */}
      <div className="bg-surface-base border border-border-default p-3 panel-beveled" style={{ borderRadius: 2 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase text-rmpg-400">Detected Kind</div>
            <div className="text-[15px] font-semibold text-brand-gold-500">{formatEnumValue(extraction.kind)}</div>
          </div>
          <div className="border-l border-border-default pl-3">
            <div className="text-[10px] uppercase text-rmpg-400">Tier</div>
            <div className="text-[12px] font-mono">
              {extraction.tier === 'implemented'
                ? <span style={{ color: 'rgb(var(--sev-ok-rgb, 34 197 94))' }}>● implemented</span>
                : <span style={{ color: 'rgb(var(--sev-warn-rgb, 245 158 11))' }}>● stub (low coverage)</span>}
            </div>
          </div>
          <div className="border-l border-border-default pl-3">
            <div className="text-[10px] uppercase text-rmpg-400">Confidence</div>
            <div className="text-[12px]" style={{ color: summaryColor.dot }}>
              {(extraction.confidence * 100).toFixed(0)}% — {summaryColor.label}
            </div>
          </div>
          <div className="border-l border-border-default pl-3">
            <div className="text-[10px] uppercase text-rmpg-400">Pages</div>
            <div className="text-[12px]">{extraction.pageCount}</div>
          </div>
          <div className="border-l border-border-default pl-3">
            <div className="text-[10px] uppercase text-rmpg-400">OCR</div>
            <div className="text-[12px]">{extraction.usedOcr ? 'fallback ran' : 'born-digital'}</div>
          </div>
          {extraction.courtCategory && (
            <div className="border-l border-border-default pl-3">
              <div className="text-[10px] uppercase text-rmpg-400">Court Category</div>
              <div className="text-[12px]">{extraction.courtCategory}</div>
            </div>
          )}
          {isDirty && (
            <div className="ml-auto text-[10px] uppercase font-semibold text-brand-gold-500 border border-brand-gold-500 px-2 py-0.5" style={{ borderRadius: 2 }}>
              Unsaved edits
            </div>
          )}
        </div>
      </div>

      {/* Field list */}
      <div className="bg-surface-base border border-border-default panel-beveled" style={{ borderRadius: 2 }}>
        <div className="px-3 py-2 border-b border-border-default text-[10px] uppercase font-semibold text-rmpg-400 flex justify-between">
          <span>Extracted Fields ({extraction.fields.length})</span>
          <span className="text-fg-muted">edit anything before saving · click revert to reset to OCR value</span>
        </div>
        <div className="divide-y divide-[var(--border-subtle)]">
          {extraction.fields.map((f) => {
            const c = confidenceColor(f.confidence);
            const original = ocrByKey[f.key] ?? '';
            const dirty = edits[f.key] !== original;
            return (
              <div key={f.key} className="grid grid-cols-12 gap-2 px-3 py-2 items-center" style={{ background: c.bg }}>
                <div className="col-span-3">
                  <div className="text-[11px] font-semibold uppercase text-rmpg-300">
                    <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: c.dot }} />
                    {f.matchedAnchor || f.key}
                  </div>
                  <div className="text-[9px] text-fg-muted font-mono mt-0.5">{f.key}</div>
                </div>
                <div className="col-span-7">
                  <input id={`ff-documentintakereviewer-${f.key}`}
                    type="text"
                    value={edits[f.key] ?? ''}
                    onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })}
                    className="w-full bg-surface-sunken border border-border-default px-2 py-1 text-[11px] text-rmpg-100"
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
                      aria-label={`Reset ${f.key} to OCR value`}
                      className="text-rmpg-400 hover:text-brand-gold-500"
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

      {/* Incident picker — only when the kind attaches to an existing incident */}
      {canSaveDirect && needsIncident && (
        <IncidentPicker
          selectedId={selectedIncident?.id ?? null}
          onSelect={setSelectedIncident}
        />
      )}

      {/* Action bar */}
      <div className="bg-surface-base border border-border-default p-3 panel-beveled flex items-center gap-2 flex-wrap" style={{ borderRadius: 2 }}>
        {canSaveDirect ? (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (needsIncident && !selectedIncident)}
            title={needsIncident && !selectedIncident ? 'Pick an incident above to enable save' : undefined}
            className="px-3 py-1.5 text-[11px] font-semibold uppercase border border-brand-gold-500 text-brand-gold-500 hover:bg-brand-gold-500 hover:text-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            style={{ borderRadius: 2 }}
          >
            {saving ? <Save className="w-3.5 h-3.5 animate-pulse" /> : <Check className="w-3.5 h-3.5" />}
            {needsIncident
              ? `Attach to ${selectedIncident?.incident_number ?? 'incident…'}`
              : `Save to Records as ${extraction.kind}`}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-brand-gold-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            No direct save handler for "{extraction.kind}" yet — use Print Intake Report / Download JSON below
          </div>
        )}
        <button
          type="button"
          onClick={handlePrintPdf}
          disabled={printingPdf}
          className="px-3 py-1.5 text-[11px] uppercase border border-rmpg-600 text-rmpg-300 hover:bg-surface-raised disabled:opacity-50 flex items-center gap-1.5"
          style={{ borderRadius: 2 }}
          title="Print a one-pager of this extraction (clerk trail / discovery)"
        >
          {printingPdf
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Printer className="w-3.5 h-3.5" />}
          Print Intake Report
        </button>
        <button
          type="button"
          onClick={handleDownloadJson}
          className="px-3 py-1.5 text-[11px] uppercase border border-rmpg-600 text-rmpg-300 hover:bg-surface-raised flex items-center gap-1.5"
          style={{ borderRadius: 2 }}
        >
          <Download className="w-3.5 h-3.5" /> Download JSON
        </button>
        <button
          type="button"
          onClick={handleRequestReset}
          className="ml-auto px-3 py-1.5 text-[11px] uppercase border border-rmpg-600 text-rmpg-400 hover:text-rmpg-100"
          style={{ borderRadius: 2 }}
          title={isDirty
            ? 'You have unsaved edits — you will be asked to confirm before resetting'
            : 'Discard this extraction and upload another'}
        >
          Upload Another
        </button>
      </div>

      {/* Raw text preview (collapsed by default) */}
      <details className="bg-surface-sunken border border-border-default panel-beveled" style={{ borderRadius: 2 }}>
        <summary className="px-3 py-2 cursor-pointer text-[10px] uppercase text-rmpg-400">
          Raw OCR text preview ({extraction.rawTextPreview.length.toLocaleString()} chars)
        </summary>
        <pre className="p-3 text-[10px] font-mono text-rmpg-400 whitespace-pre-wrap max-h-[300px] overflow-auto">
          {extraction.rawTextPreview}
        </pre>
      </details>

      {/* Discard-edits confirmation — replaces the previous silent reset */}
      <ConfirmDialog
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); onReset(); }}
        title="Discard pending edits?"
        message={`You have unsaved edits to this extraction. Uploading another document will discard them.`}
        details={
          <div className="text-[11px] text-rmpg-400 font-mono">
            Detected kind: {extraction.kind} · {extraction.fields.length} fields
            {filename ? <> · source: {filename}</> : null}
          </div>
        }
        confirmLabel="Discard and upload another"
        cancelLabel="Keep editing"
        confirmVariant="warning"
      />
    </div>
  );
}
