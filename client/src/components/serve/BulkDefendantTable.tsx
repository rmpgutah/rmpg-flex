// ============================================================
// Bulk Defendant Table
//
// Pre-upload editable spreadsheet for batch-creating dispatch jobs.
// Each row becomes one CFS via POST /api/serve-intake/bulk.
//
// Supports paste-from-spreadsheet (TSV/CSV detected on Cmd+V into the
// "PASTE" cell) and per-row toggle between Individual and Business modes.
// ============================================================

import React, { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

export type BulkRowKind = 'individual' | 'business';

export interface BulkRow {
  kind: BulkRowKind;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  sex: string;
  businessName: string;
  address: string;
  contractId: string;
}

const EMPTY_ROW: BulkRow = {
  kind: 'individual',
  firstName: '', middleName: '', lastName: '',
  dob: '', sex: '',
  businessName: '',
  address: '',
  contractId: '',
};

export interface BulkSubmitResult {
  success: boolean;
  created: Array<{ rowIndex: number; call_id: number; call_number: string }>;
  merged: Array<{ rowIndex: number; call_id: number; call_number: string; reason: string }>;
  errors: Array<{ rowIndex: number; message: string }>;
  summary: { total: number; created: number; merged: number; failed: number };
}

interface Props {
  onSubmitted?: (result: BulkSubmitResult) => void;
}

// Parse pasted TSV (tab-separated, what Excel/Google Sheets paste produces)
// or CSV. Returns rows in the column order: firstName, middleName, lastName,
// dob, sex, address, contractId, businessName.
function parsePastedTable(raw: string): BulkRow[] {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const rows: BulkRow[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    // Auto-detect delimiter: tabs first (spreadsheet copy), then commas (CSV).
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    const c = parts.map((p) => p.trim().replace(/^"(.*)"$/, '$1'));
    const hasBusiness = (c[7] || '').trim().length > 0;
    rows.push({
      kind: hasBusiness ? 'business' : 'individual',
      firstName: c[0] || '',
      middleName: c[1] || '',
      lastName: c[2] || '',
      dob: c[3] || '',
      sex: c[4] || '',
      address: c[5] || '',
      contractId: c[6] || '',
      businessName: c[7] || '',
    });
  }
  return rows;
}

export default function BulkDefendantTable({ onSubmitted }: Props) {
  const [rows, setRows] = useState<BulkRow[]>([{ ...EMPTY_ROW }]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validRowCount = useMemo(
    () => rows.filter((r) => {
      if (!r.address.trim()) return false;
      if (r.kind === 'business') return !!r.businessName.trim();
      return !!(r.firstName.trim() || r.lastName.trim());
    }).length,
    [rows],
  );

  const updateRow = useCallback((idx: number, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
    setResult(null);
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }, []);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return; // not table data, let default paste happen
    e.preventDefault();
    const parsed = parsePastedTable(text);
    if (parsed.length === 0) return;
    setRows((prev) => {
      // If only one empty row and parsed has data, replace it; else append.
      const allBlank = prev.length === 1 && Object.entries(prev[0]).every(([k, v]) => k === 'kind' || (typeof v === 'string' && !v.trim()));
      return allBlank ? parsed : [...prev, ...parsed];
    });
    setResult(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setResult(null);
    const payload = rows.filter((r) => {
      if (!r.address.trim()) return false;
      if (r.kind === 'business') return !!r.businessName.trim();
      return !!(r.firstName.trim() || r.lastName.trim());
    });
    if (payload.length === 0) {
      setError('Add at least one row with an address and a defendant name.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<BulkSubmitResult>('/serve-intake/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows: payload }),
      });
      setResult(res);
      if (onSubmitted) onSubmitted(res);
    } catch (err: any) {
      setError(err?.message || 'Bulk intake failed');
    } finally {
      setSubmitting(false);
    }
  }, [rows, onSubmitted]);

  const clearAll = useCallback(() => {
    setRows([{ ...EMPTY_ROW }]);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="panel-beveled p-3 bg-surface-base space-y-3" onPaste={handlePaste}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Bulk Defendant Table</h3>
          <span className="text-[10px] text-rmpg-500">{validRowCount} valid row{validRowCount === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addRow} className="toolbar-btn text-[9px]" title="Add a blank row"><Plus className="w-3 h-3" /> Add Row</button>
          <button type="button" onClick={clearAll} className="toolbar-btn text-[9px]" title="Clear table">Clear</button>
        </div>
      </div>

      <p className="text-[10px] text-rmpg-400 leading-relaxed">
        One row per defendant — each row creates one dispatch job. Tip: copy from a spreadsheet (columns:
        First / Middle / Last / DOB / Sex / Address / Contract ID / Business Name) and paste anywhere in the table.
        Rows with a Business Name are treated as business-entity service; rows without are treated as individual.
      </p>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border border-[#222]">
          <thead>
            <tr className="bg-surface-raised text-rmpg-400 text-[9px] uppercase">
              <th className="px-1.5 py-1 text-left border-b border-[#222]">#</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">First</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Middle</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Last</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">DOB</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Sex</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Address</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Contract ID</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]">Business Name (optional)</th>
              <th className="px-1.5 py-1 text-left border-b border-[#222]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isBiz = r.kind === 'business' || !!r.businessName.trim();
              return (
                <tr key={idx} className="border-b border-[#1a1a1a]">
                  <td className="px-1.5 py-1 text-rmpg-500 align-top">{idx + 1}</td>
                  {(['firstName', 'middleName', 'lastName', 'dob', 'sex', 'address', 'contractId', 'businessName'] as const).map((field) => (
                    <td key={field} className="px-0 py-0 align-top">
                      <input
                        type="text"
                        value={(r as any)[field]}
                        disabled={isBiz && (field === 'firstName' || field === 'middleName' || field === 'lastName' || field === 'dob' || field === 'sex')}
                        onChange={(e) => {
                          const patch: Partial<BulkRow> = { [field]: e.target.value } as any;
                          if (field === 'businessName' && e.target.value.trim()) patch.kind = 'business';
                          if (field === 'businessName' && !e.target.value.trim() && !r.firstName && !r.lastName) patch.kind = 'individual';
                          updateRow(idx, patch);
                        }}
                        placeholder={
                          field === 'dob' ? 'MM/DD/YYYY' :
                          field === 'sex' ? 'M / F / X' :
                          field === 'address' ? '123 Main St, City, ST 00000' :
                          ''
                        }
                        className="w-full bg-transparent border-0 px-1.5 py-1 text-[11px] text-white focus:outline-none focus:bg-amber-900/10 disabled:bg-[#0a0a0a] disabled:text-rmpg-700"
                        style={{ minWidth: field === 'address' ? 220 : field === 'businessName' ? 180 : field === 'middleName' ? 70 : 100 }}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-0 align-top text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      disabled={rows.length === 1}
                      className="toolbar-btn text-[9px]"
                      title="Remove row"
                      aria-label={`Remove row ${idx + 1}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="text-[11px] text-red-400 border border-red-900 bg-red-950/40 p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className={`text-[11px] border p-2 ${result.summary.failed === 0 ? 'border-green-900 bg-green-950/30 text-green-300' : 'border-amber-700 bg-amber-950/30 text-amber-200'}`}>
          <div className="flex items-center gap-2 font-bold mb-1">
            {result.summary.failed === 0 ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span>
              Bulk intake complete: {result.summary.created} new job(s) created
              {result.summary.merged > 0 ? `, ${result.summary.merged} merged into existing CFS` : ''}
              {result.summary.failed > 0 ? `, ${result.summary.failed} failed` : ''}
              {' '}of {result.summary.total} submitted.
            </span>
          </div>
          {result.created.length > 0 && (
            <div className="text-[10px] text-rmpg-300 mt-1">
              Created call numbers: {result.created.map((c) => c.call_number).join(', ')}
            </div>
          )}
          {result.merged && result.merged.length > 0 && (
            <ul className="text-[10px] text-amber-200 mt-1 list-disc list-inside">
              {result.merged.map((m) => <li key={m.rowIndex}>Row {m.rowIndex + 1}: merged into {m.call_number} ({m.reason})</li>)}
            </ul>
          )}
          {result.errors.length > 0 && (
            <ul className="text-[10px] text-amber-300 mt-1 list-disc list-inside">
              {result.errors.map((e) => <li key={e.rowIndex}>Row {e.rowIndex + 1}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[9px] text-rmpg-500">
          {validRowCount > 0 ? `Submitting will create ${validRowCount} dispatch CFS row${validRowCount === 1 ? '' : 's'}. PDFs can be attached individually after.` : 'Add row data to enable submit.'}
        </p>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || validRowCount === 0}
          className="toolbar-btn toolbar-btn-primary text-[11px] disabled:opacity-50"
        >
          {submitting ? <><Loader2 className="w-3 h-3 animate-spin" /> Submitting…</> : <>Create {validRowCount} Job{validRowCount === 1 ? '' : 's'}</>}
        </button>
      </div>
    </div>
  );
}
