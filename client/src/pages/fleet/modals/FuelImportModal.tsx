// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fuel CSV Import Modal
//
// Three-step flow over a single modal:
//   1. FILE       drop-zone / file picker for the CSV
//   2. PREVIEW    server-parsed rows with vehicle matches highlighted
//                 and a dropdown to fix unmatched rows manually
//   3. COMMIT     POST reviewed rows to /fleet/fuel/import/commit,
//                 show insert + error count, close on success
//
// The preview endpoint detects column aliases for WEX / Voyager /
// Fuelman / generic CSV exports. Rows flagged with warnings (e.g.
// "no vehicle match") are still visible but excluded from the commit
// payload until the user resolves them.
// ═══════════════════════════════════════════════════════════════

import { useState, useId, useRef } from 'react';
import { Upload, FileText, AlertCircle, Check, Loader2, Car } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { apiFetch } from '../../../hooks/useApi';

interface FleetVehicle {
  id: string | number;
  vehicle_number: string;
  plate?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
}

interface PreviewRow {
  row_index: number;
  raw: string[];
  matched: boolean;
  vehicle_id: number | null;
  vehicle_display: string | null;
  vehicle_hint: string | null;
  fuel_date: string | null;
  gallons: number | null;
  cost_per_gallon: number | null;
  total_cost: number | null;
  odometer_reading: number | null;
  station: string | null;
  fuel_type: 'regular' | 'premium' | 'diesel';
  warnings: string[];
}

interface PreviewResponse {
  headers: string[];
  column_map: Record<string, string | null>;
  row_count: number;
  matched_count: number;
  rows: PreviewRow[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  vehicles: FleetVehicle[];
}

export default function FuelImportModal({ isOpen, onClose, onImported, vehicles }: Props) {
  const titleId = useId();
  const [phase, setPhase] = useState<'file' | 'preview' | 'committing' | 'done'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState('');
  const [commitResult, setCommitResult] = useState<{ inserted: number; errors: any[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const reset = () => {
    setPhase('file');
    setFile(null);
    setPreview(null);
    setRows([]);
    setError('');
    setCommitResult(null);
  };

  const handleClose = () => {
    if (phase === 'committing') return;
    reset();
    onClose();
  };

  const handleUpload = async (f: File) => {
    setFile(f);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch(`${window.location.origin}/api/fleet/fuel/import/preview`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPreview(data);
      setRows(data.rows);
      setPhase('preview');
    } catch (err: any) {
      setError(err?.message || 'Failed to parse CSV');
    }
  };

  const updateRow = (index: number, patch: Partial<PreviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const rowIsCommittable = (r: PreviewRow) =>
    !!r.vehicle_id && !!r.fuel_date && r.gallons != null && r.gallons > 0;

  const handleCommit = async () => {
    setPhase('committing');
    setError('');
    try {
      const toSend = rows.filter(rowIsCommittable);
      if (toSend.length === 0) {
        setError('No committable rows — each row needs a vehicle, a date, and gallons.');
        setPhase('preview');
        return;
      }
      const result = await apiFetch<{ inserted: number; errors: any[] }>('/fleet/fuel/import/commit', {
        method: 'POST',
        body: JSON.stringify({ rows: toSend }),
      });
      setCommitResult(result);
      setPhase('done');
      if (result.inserted > 0) onImported();
    } catch (err: any) {
      setError(err?.message || 'Commit failed');
      setPhase('preview');
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center"
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={phase === 'committing' ? undefined : handleClose}>
      <div className="panel-beveled w-[900px] max-w-full mx-4 max-h-[90vh] flex flex-col bg-surface-raised"
        onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title="IMPORT FUEL LOGS FROM CSV" icon={Upload} id={titleId}>
          <button type="button" className="toolbar-btn text-[9px]" onClick={handleClose}>X</button>
        </PanelTitleBar>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20 mb-3">
              <div className="flex items-center gap-1.5 text-[10px] text-red-400"><AlertCircle className="w-3 h-3" />{error}</div>
            </div>
          )}

          {/* ── PHASE 1: file picker ─────────────────────────── */}
          {phase === 'file' && (
            <div className="space-y-3">
              <p className="text-[10px] text-rmpg-400">
                Drop a CSV from your fuel card provider (WEX, Voyager, Fuelman) or a generic export.
                The server will auto-map common column names and try to match each row to a vehicle by
                <span className="text-brand-400"> vehicle number</span>,
                <span className="text-brand-400"> license plate</span>, or
                <span className="text-brand-400"> fuel card number</span>.
              </p>
              <button type="button"
                className="w-full panel-beveled bg-surface-sunken border-dashed p-8 flex flex-col items-center gap-2 hover:border-brand-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-8 h-8 text-rmpg-500" />
                <span className="text-[11px] text-rmpg-300">Click to select a .csv file</span>
                <span className="text-[9px] text-rmpg-500">Max 10 MB</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
            </div>
          )}

          {/* ── PHASE 2: preview ─────────────────────────────── */}
          {phase === 'preview' && preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="panel-beveled p-2 bg-surface-sunken text-center">
                  <div className="text-sm font-bold font-mono text-gray-400">{preview.row_count}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Rows Detected</div>
                </div>
                <div className="panel-beveled p-2 bg-surface-sunken text-center">
                  <div className="text-sm font-bold font-mono text-green-400">{rows.filter(rowIsCommittable).length}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Ready to Commit</div>
                </div>
                <div className="panel-beveled p-2 bg-surface-sunken text-center">
                  <div className="text-sm font-bold font-mono text-amber-400">{rows.filter(r => !rowIsCommittable(r)).length}</div>
                  <div className="text-[8px] text-rmpg-500 uppercase">Needs Review</div>
                </div>
              </div>

              <div className="text-[9px] text-rmpg-500">
                <span className="font-bold">Column map:</span>{' '}
                {Object.entries(preview.column_map).filter(([, v]) => v).map(([k, v]) => (
                  <span key={k} className="font-mono mr-2"><span className="text-rmpg-400">{k}</span> <span className="text-rmpg-600">→</span> <span className="text-brand-400">{v}</span></span>
                ))}
              </div>

              <div className="panel-beveled bg-surface-sunken overflow-auto max-h-[40vh]">
                <table className="w-full text-[10px] font-mono">
                  <thead className="bg-surface-raised sticky top-0">
                    <tr className="text-left text-[9px] uppercase text-rmpg-500">
                      <th className="px-2 py-1">Row</th>
                      <th className="px-2 py-1">Vehicle</th>
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1 text-right">Gal</th>
                      <th className="px-2 py-1 text-right">$/Gal</th>
                      <th className="px-2 py-1 text-right">Total</th>
                      <th className="px-2 py-1">Station</th>
                      <th className="px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const ok = rowIsCommittable(r);
                      return (
                        <tr key={i} className={`border-t border-rmpg-800 ${ok ? '' : 'bg-amber-900/10'}`}>
                          <td className="px-2 py-1 text-rmpg-500">{r.row_index}</td>
                          <td className="px-2 py-1">
                            {r.matched && r.vehicle_display ? (
                              <span className="text-green-400 flex items-center gap-1"><Car className="w-2.5 h-2.5" />{r.vehicle_display}</span>
                            ) : (
                              <select className="select-dark text-[10px] py-0.5"
                                value={r.vehicle_id ?? ''}
                                onChange={(e) => {
                                  const vid = e.target.value ? Number(e.target.value) : null;
                                  const veh = vehicles.find(v => Number(v.id) === vid);
                                  updateRow(i, {
                                    vehicle_id: vid,
                                    matched: !!vid,
                                    vehicle_display: veh ? `#${veh.vehicle_number} — ${[veh.year, veh.make, veh.model].filter(Boolean).join(' ')}` : null,
                                  });
                                }}>
                                <option value="">— pick vehicle ({r.vehicle_hint || 'no hint'}) —</option>
                                {vehicles.map(v => (
                                  <option key={v.id} value={v.id}>
                                    #{v.vehicle_number} {v.plate ? `(${v.plate})` : ''}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-2 py-1">{r.fuel_date || <span className="text-red-400">—</span>}</td>
                          <td className="px-2 py-1 text-right">{r.gallons != null ? r.gallons.toFixed(3) : <span className="text-red-400">—</span>}</td>
                          <td className="px-2 py-1 text-right">{r.cost_per_gallon != null ? r.cost_per_gallon.toFixed(3) : ''}</td>
                          <td className="px-2 py-1 text-right">{r.total_cost != null ? `$${r.total_cost.toFixed(2)}` : ''}</td>
                          <td className="px-2 py-1 text-rmpg-400">{r.station || ''}</td>
                          <td className="px-2 py-1">
                            {ok ? <Check className="w-3 h-3 text-green-400" />
                              : <span className="text-[8px] text-amber-400" title={r.warnings.join('; ')}>{r.warnings.join(', ')}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── PHASE 3: committing ──────────────────────────── */}
          {phase === 'committing' && (
            <div className="flex flex-col items-center py-8 gap-2">
              <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
              <span className="text-[11px] text-rmpg-300">Committing {rows.filter(rowIsCommittable).length} rows...</span>
            </div>
          )}

          {/* ── PHASE 4: done ────────────────────────────────── */}
          {phase === 'done' && commitResult && (
            <div className="panel-beveled p-4 bg-surface-sunken text-center">
              <Check className="w-8 h-8 mx-auto text-green-400 mb-2" />
              <div className="text-sm font-bold text-green-400">{commitResult.inserted} rows imported</div>
              {commitResult.errors.length > 0 && (
                <div className="mt-2 text-[10px] text-amber-400">
                  {commitResult.errors.length} row{commitResult.errors.length === 1 ? '' : 's'} skipped
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={handleClose} disabled={phase === 'committing'}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'preview' && (
            <button type="button" className="toolbar-btn toolbar-btn-primary"
              onClick={handleCommit}
              disabled={rows.filter(rowIsCommittable).length === 0}>
              <FileText className="w-3 h-3" /> Import {rows.filter(rowIsCommittable).length} Rows
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
