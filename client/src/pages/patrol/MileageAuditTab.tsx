// ============================================================
// MileageAuditTab — admin mileage correction / audit / chain
// rewrite UI for the Patrol page.
//
// Renders:
//   1. Anchor panel — current mileage + accumulated offset for
//      the selected (officer, unit) scope, with a "Use this
//      value" affordance to prefill the suggested starting
//      mileage elsewhere (e.g. on a new CFS).
//   2. Chain view — chronological list of calls_for_service
//      rows that touched mileage in the window, with the
//      starting→ending transition, total distance, and a
//      "Correct this entry" form per row.
//   3. Fix form — admin/manager/supervisor only. Body:
//      { entry_table, entry_id, field, after_value, reason,
//        scope: { officer_id, unit_id }, propagate_chain }.
//      Submits to POST /api/patrol/mileage/fix which performs
//      the chain rewrite and writes the audit row.
//   4. Audit history — list of past corrections in the window
//      so the admin sees the trail.
//   5. Trip Log download — button that fires GET
//      /api/patrol/trip-log/generate and renders the FORM
//      PS-211 PDF (via the v2 PDF engine).
//
// All actions degrade gracefully on error (the chain / audit /
// anchor fetches are independent).
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  Gauge,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr, safeTimeStr, parseTimestamp } from '../../utils/dateUtils';
import IconButton from '../../components/IconButton';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import { renderPdfV2, downloadPdfV2 } from '../../utils/pdf/v2';
import { tripLogSchema, type TripLogData } from '../../utils/pdf/v2/forms/tripLog';

type ChainRow = {
  id: number;
  call_number: string | null;
  incident_type: string | null;
  status: string | null;
  dispatched_at: string | null;
  enroute_at: string | null;
  onscene_at: string | null;
  cleared_at: string | null;
  closed_at: string | null;
  starting_mileage: number | null;
  ending_mileage: number | null;
  starting_mileage_corrected?: boolean;
  ending_mileage_corrected?: boolean;
  last_fix?: { delta: number; reason: string | null; created_at: string; created_by_name: string | null } | null;
  audit_count?: number;
};

type AuditRow = {
  id: number;
  entry_table: string;
  entry_id: number;
  field: string;
  before_value: number | null;
  after_value: number | null;
  delta: number;
  cascade_count: number;
  reason: string | null;
  created_at: string;
  created_by: number | null;
  created_by_name: string | null;
};

type Anchor = {
  current_mileage: number;
  offset_miles: number;
  last_entry_at: string | null;
  scope_key?: string;
} | null;

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number): string =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const isFixable = (user: { role?: string } | null): boolean =>
  !!user && ['admin', 'manager', 'supervisor'].includes(user.role || '');

export default function MileageAuditTab() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canFix = isFixable(user);

  // Scope pickers default to the logged-in officer + their assigned unit.
  // User.id is a string (UUID-ish) in our auth model; the API accepts
  // either a numeric or string-shaped id via the `officer_id` query param
  // and the `units.officer_id` FK is numeric, so we coerce at the API
  // boundary. For the dropdown, we keep the id as a string.
  const [officerId, setOfficerId] = useState<string>(user?.id ?? '');
  const [unitId, setUnitId] = useState<number | ''>('');
  const [from, setFrom] = useState<string>(daysAgoIso(7));
  const [to, setTo] = useState<string>(todayIso());

  // Loaded state
  const [anchor, setAnchor] = useState<Anchor>(null);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against setState on unmounted component — the refresh
  // callback does multiple async apiFetch calls; if the user switches
  // tabs or navigates between them, setState fires on a dead component.
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Reference data (officers, units)
  const [officers, setOfficers] = useState<Array<{ id: number; full_name: string }>>([]);
  const [units, setUnits] = useState<Array<{ id: number; call_sign: string; officer_id: number | null }>>([]);

  // Fix form (per row, expanded inline)
  const [openFixRowId, setOpenFixRowId] = useState<number | null>(null);
  const [fixField, setFixField] = useState<'starting_mileage' | 'ending_mileage'>('ending_mileage');
  const [fixAfter, setFixAfter] = useState<string>('');
  const [fixReason, setFixReason] = useState<string>('');
  const [fixPropagate, setFixPropagate] = useState<boolean>(true);
  const [fixSubmitting, setFixSubmitting] = useState(false);

  // Trip log PDF download state
  const [tripLog, setTripLog] = useState<TripLogData | null>(null);
  const [tripLogLoading, setTripLogLoading] = useState(false);

  // ── Load reference data once ──
  useEffect(() => {
    (async () => {
      try {
        const u = await apiFetch<any[]>('/personnel?role=officer');
        setOfficers((Array.isArray(u) ? u : []).map((r: any) => ({ id: r.id, full_name: r.full_name || r.username })));
      } catch {
        // Non-fatal — officer dropdown just stays empty.
      }
      try {
        const us = await apiFetch<any[]>('/dispatch/units');
        setUnits((us || []).map((r: any) => ({ id: r.id, call_sign: r.call_sign, officer_id: r.officer_id })));
      } catch {
        // Non-fatal.
      }
    })();
  }, []);

  // ── Auto-pick the assigned unit when the user is an officer ──
  useEffect(() => {
    if (units.length > 0 && officerId !== '' && unitId === '') {
      const officerNum = Number(officerId);
      const assigned = units.find((u) => {
        if (u.officer_id == null) return false;
        return Number(u.officer_id) === (Number.isFinite(officerNum) ? officerNum : -1) ||
               String(u.officer_id) === officerId;
      });
      if (assigned) setUnitId(assigned.id);
    }
  }, [units, officerId, unitId]);

  const refresh = useCallback(async () => {
    if (officerId === '' && unitId === '') {
      setError('Pick an officer and/or unit to load the mileage chain.');
      setRows([]);
      setAnchor(null);
      return;
    }
    setLoading(true);
    setError(null);
    const chainParams = new URLSearchParams();
    if (officerId !== '') chainParams.set('officer_id', officerId);
    if (unitId !== '') chainParams.set('unit_id', String(unitId));
    if (from) chainParams.set('from', from);
    if (to) chainParams.set('to', `${to} 23:59:59`);

    try {
      const data = await apiFetch<{ anchor: Anchor; rows: ChainRow[] }>(`/patrol/mileage/chain?${chainParams}`);
      if (!mountedRef.current) return;
      setAnchor(data.anchor || null);
      setRows(data.rows || []);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || 'Failed to load chain');
      setRows([]);
    }

    if (canFix && (officerId !== '' || unitId !== '')) {
      try {
        const auditParams = new URLSearchParams(chainParams);
        const a = await apiFetch<{ rows: AuditRow[] }>(`/patrol/mileage/audit?${auditParams}`);
        if (!mountedRef.current) return;
        setAudit(a.rows || []);
      } catch {
        if (!mountedRef.current) return;
        setAudit([]);
      }
    } else {
      if (!mountedRef.current) return;
      setAudit([]);
    }
    if (!mountedRef.current) return;
    setLoading(false);
  }, [officerId, unitId, from, to, canFix]);

  useEffect(() => { refresh(); }, [refresh]);

  const openFix = (row: ChainRow) => {
    setOpenFixRowId(row.id);
    setFixField('ending_mileage');
    setFixAfter(String(row.ending_mileage ?? ''));
    setFixReason('');
    setFixPropagate(true);
  };
  const cancelFix = () => {
    setOpenFixRowId(null);
    setFixAfter('');
    setFixReason('');
    setFixSubmitting(false);
  };

  const submitFix = async (row: ChainRow) => {
    if (!canFix) return;
    if (!fixAfter || isNaN(parseFloat(fixAfter))) {
      addToast('Enter a numeric after_value', 'error');
      return;
    }
    if (!fixReason.trim()) {
      addToast('Reason is required for the audit trail', 'error');
      return;
    }
    setFixSubmitting(true);
    try {
      const result = await apiFetch<{ is_backfill?: boolean; fix: { before: number | null; after: number; delta: number }; cascade: { count: number } }>('/patrol/mileage/fix', {
        method: 'POST',
        body: JSON.stringify({
          entry_table: 'calls_for_service',
          entry_id: row.id,
          field: fixField,
          after_value: parseFloat(fixAfter),
          reason: fixReason.trim(),
          scope: {
            officer_id: officerId === '' ? null : Number(officerId),
            unit_id: unitId === '' ? null : unitId,
          },
          propagate_chain: fixPropagate,
        }),
      });
      const beforeStr = result.fix.before == null ? '—' : Number(result.fix.before).toLocaleString();
      addToast(
        (result.is_backfill ? 'Mileage set' : 'Fix applied') +
        `: ${beforeStr} → ${Number(result.fix.after).toLocaleString()} mi` +
        (result.is_backfill ? '' : ` (Δ ${result.fix.delta >= 0 ? '+' : ''}${result.fix.delta.toFixed(1)} mi)`) +
        (result.cascade.count > 0 ? ` — ${result.cascade.count} row(s) rewritten` : ''),
        'success',
      );
      cancelFix();
      refresh();
    } catch (err: any) {
      addToast(err?.message || 'Fix failed', 'error');
      setFixSubmitting(false);
    }
  };

  const handleCopyAnchor = () => {
    if (!anchor) return;
    navigator.clipboard?.writeText(String(anchor.current_mileage));
    addToast(`Copied ${anchor.current_mileage} to clipboard`, 'success');
  };

  const handleDownloadTripLog = async () => {
    setTripLogLoading(true);
    try {
      const params = new URLSearchParams();
      if (officerId !== '') params.set('officer_id', officerId);
      if (unitId !== '') params.set('unit_id', String(unitId));
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const data = await apiFetch<TripLogData>(`/patrol/trip-log/generate?${params}`);
      setTripLog(data);
      const stamp = new Date().toISOString().slice(0, 10);
      const namePart = data.meta.officer_name || 'officer';
      const unitPart = data.meta.unit_call_sign ? `_${data.meta.unit_call_sign}` : '';
      const filename = `PS-211_trip_log_${namePart.replace(/\s+/g, '_')}${unitPart}_${stamp}.pdf`;
      await downloadPdfV2(tripLogSchema, data, filename, { schemaId: 'trip_log' });
      addToast(`FORM PS-211 generated: ${data.rows.length} rows`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Trip log generation failed', 'error');
    }
    setTripLogLoading(false);
  };

  const renderFixForm = (row: ChainRow) => {
    const original = row[fixField as 'starting_mileage' | 'ending_mileage'];
    // A null original means we're backfilling a never-stamped value, not
    // correcting one — there is no delta to propagate down the chain.
    const isBackfill = original == null;
    const previewDelta = (parseFloat(fixAfter) || 0) - (Number(original) || 0);
    const willRewrite = !isBackfill && fixPropagate && previewDelta !== 0;
    return (
      <tr className="bg-amber-950/20">
        <td colSpan={6} className="px-3 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div>
              <label className="block text-[9px] text-amber-300 mb-0.5">Field</label>
              <select
                className="input-dark w-full min-h-[28px] text-xs"
                value={fixField}
                onChange={(e) => setFixField(e.target.value as 'starting_mileage' | 'ending_mileage')}
              >
                <option value="ending_mileage">ending_mileage</option>
                <option value="starting_mileage">starting_mileage</option>
              </select>
            </div>
            <div>
              <label className="block text-[9px] text-amber-300 mb-0.5">
                New value (was {original == null ? '—' : Number(original).toLocaleString()})
              </label>
              <input
                type="number"
                step="0.1"
                className="input-dark w-full min-h-[28px] text-xs font-mono"
                value={fixAfter}
                onChange={(e) => setFixAfter(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[9px] text-amber-300 mb-0.5">
                Reason (required — written to mileage_audit)
              </label>
              <input
                type="text"
                className="input-dark w-full min-h-[28px] text-xs"
                placeholder="e.g. Officer re-keyed odometer from dash; original 91205.6 was a misread"
                value={fixReason}
                onChange={(e) => setFixReason(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <label className={`flex items-center gap-1.5 text-[10px] ${isBackfill ? 'text-rmpg-500' : 'text-rmpg-200'}`}>
                <input
                  type="checkbox"
                  checked={fixPropagate && !isBackfill}
                  disabled={isBackfill}
                  onChange={(e) => setFixPropagate(e.target.checked)}
                />
                Rewrite subsequent rows in this scope by the same delta
              </label>
              {isBackfill ? (
                <span className="text-[10px] text-rmpg-400 italic">
                  Backfilling a missing value — no chain rewrite.
                </span>
              ) : willRewrite && (
                <span className="text-[10px] font-mono text-amber-300">
                  Δ {previewDelta >= 0 ? '+' : ''}{previewDelta.toFixed(1)} mi will propagate
                </span>
              )}
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelFix}
                className="toolbar-btn text-[10px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submitFix(row)}
                disabled={fixSubmitting}
                className="toolbar-btn toolbar-btn-primary text-[10px]"
              >
                {fixSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Apply Fix
              </button>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  const totals = useMemo(() => {
    let distance = 0, duration = 0, harshA = 0, harshB = 0, harshC = 0;
    for (const r of rows) {
      const sm = r.starting_mileage;
      const em = r.ending_mileage;
      if (sm != null && em != null) distance += Math.max(0, em - sm);
      const dur = (() => {
        const a = r.cleared_at || r.closed_at;
        const b = r.dispatched_at || r.enroute_at || r.onscene_at || a;
        if (!a || !b) return 0;
        return Math.max(0, Math.round((parseTimestamp(a).getTime() - parseTimestamp(b).getTime()) / 60000));
      })();
      duration += dur;
    }
    return { distance: distance.toFixed(1), duration, harshA, harshB, harshC };
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* ── Scope pickers + actions ──────────────────────────── */}
      <div className="panel-beveled bg-surface-base p-3">
        <div className="flex items-center gap-2 mb-2">
          <Wrench className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-100">Mileage Audit</h3>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="toolbar-btn text-[10px]"
              disabled={loading}
              aria-label="Refresh chain + audit"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
            <button
              type="button"
              onClick={handleDownloadTripLog}
              className="toolbar-btn toolbar-btn-primary text-[10px]"
              disabled={tripLogLoading}
              title="Download FORM PS-211 Trip Log PDF"
            >
              {tripLogLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              FORM PS-211
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px]">
          <div>
            <label className="block text-[9px] text-rmpg-400 mb-0.5">Officer</label>
            <select
              className="input-dark w-full min-h-[28px] text-xs"
              value={officerId}
              onChange={(e) => setOfficerId(e.target.value)}
            >
              <option value="">— Any —</option>
              {officers.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] text-rmpg-400 mb-0.5">Unit</label>
            <select
              className="input-dark w-full min-h-[28px] text-xs"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Any —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.call_sign}{u.officer_id ? '' : ' (no officer)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] text-rmpg-400 mb-0.5">From</label>
            <input
              type="date"
              className="input-dark w-full min-h-[28px] text-xs font-mono"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[9px] text-rmpg-400 mb-0.5">To</label>
            <input
              type="date"
              className="input-dark w-full min-h-[28px] text-xs font-mono"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        {!canFix && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400">
            <ShieldAlert className="w-3 h-3" />
            You can review the chain. Mileage fixes require admin / manager / supervisor.
          </div>
        )}
      </div>

      {/* ── Anchor panel ─────────────────────────────────────── */}
      <div className="panel-beveled bg-surface-base p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Gauge className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-100">Anchor</h3>
          <span className="text-[9px] text-rmpg-500">auto-pickup baseline for the next patrol</span>
        </div>
        {anchor ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase">Current Mileage</div>
              <div className="font-mono text-brand-400 text-base font-bold tabular-nums">
                {Number(anchor.current_mileage).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi
              </div>
            </div>
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase">Offset (cumulative)</div>
              <div className={`font-mono text-base font-bold tabular-nums ${anchor.offset_miles < 0 ? 'text-amber-400' : anchor.offset_miles > 0 ? 'text-amber-400' : 'text-rmpg-300'}`}>
                {anchor.offset_miles >= 0 ? '+' : ''}{Number(anchor.offset_miles).toFixed(1)} mi
              </div>
            </div>
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase">Last Entry</div>
              <div className="font-mono text-rmpg-200 text-[11px]">
                {anchor.last_entry_at ? `${safeDateStr(anchor.last_entry_at)} ${safeTimeStr(anchor.last_entry_at)}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase">Scope Key</div>
              <div className="font-mono text-[10px] text-rmpg-300 truncate" title={anchor.scope_key}>
                {anchor.scope_key || '—'}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyAnchor}
                className="toolbar-btn text-[10px]"
                title="Copy the current mileage to the clipboard for prefill"
              >
                <ClipboardCopy className="w-3 h-3" /> Copy to clipboard
              </button>
              {anchor.offset_miles !== 0 && (
                <span className="text-[10px] text-amber-400">
                  Future entries are pre-adjusted by {anchor.offset_miles >= 0 ? '+' : ''}{Number(anchor.offset_miles).toFixed(1)} mi.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-rmpg-400 italic">
            No anchor yet for this scope. The first mileage entry will create one.
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-1.5 bg-red-900/30 border border-red-700/50 text-[11px] text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {/* ── Chain view ───────────────────────────────────────── */}
      <div className="panel-beveled bg-surface-base overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700/50">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-100">Mileage Chain</h3>
          <span className="text-[10px] text-rmpg-400">{rows.length} row(s)</span>
          {rows.length > 0 && (
            <span className="ml-auto text-[10px] text-rmpg-400 font-mono">
              Σ {totals.distance} mi · {totals.duration} min
            </span>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-rmpg-400 italic">No mileage entries in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Cleared</th>
                  <th>Call #</th>
                  <th>Type</th>
                  <th>Start → End</th>
                  <th>Distance</th>
                  <th className="print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const sm = row.starting_mileage;
                  const em = row.ending_mileage;
                  const distance = (sm != null && em != null) ? (em - sm).toFixed(1) : '—';
                  const cleared = row.cleared_at || row.closed_at;
                  const isOpen = openFixRowId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                      <tr className={row.ending_mileage_corrected || row.starting_mileage_corrected ? 'bg-amber-950/20' : ''}>
                        <td className="font-mono text-[10px] text-rmpg-300">
                          {cleared ? `${safeDateStr(cleared)} ${safeTimeStr(cleared)}` : '—'}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-rmpg-100 text-[11px]">
                              {row.call_number || `#${row.id}`}
                            </span>
                            {(row.ending_mileage_corrected || row.starting_mileage_corrected) && (
                              <span title="Corrected" className="text-amber-400"><Pencil className="w-2.5 h-2.5" /></span>
                            )}
                          </div>
                        </td>
                        <td className="text-[10px] text-rmpg-300 uppercase">
                          {row.incident_type || '—'}
                        </td>
                        <td className="font-mono text-[11px] tabular-nums">
                          {sm != null ? Number(sm).toLocaleString() : '—'}
                          <span className="text-rmpg-500 mx-1">→</span>
                          {em != null ? Number(em).toLocaleString() : '—'}
                        </td>
                        <td className="font-mono text-[11px] tabular-nums text-brand-400">
                          {distance} mi
                        </td>
                        <td className="print:hidden">
                          {canFix ? (
                            <button
                              type="button"
                              onClick={() => isOpen ? cancelFix() : openFix(row)}
                              className="toolbar-btn text-[10px]"
                              aria-label={isOpen ? 'Close fix form' : 'Open fix form'}
                            >
                              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              {isOpen ? 'Cancel' : 'Fix'}
                            </button>
                          ) : (
                            <span className="text-[10px] text-rmpg-500">—</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && renderFixForm(row)}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Audit history ────────────────────────────────────── */}
      {canFix && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700/50">
            <History className="w-3.5 h-3.5 text-rmpg-300" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-rmpg-100">Audit History</h3>
            <span className="text-[10px] text-rmpg-400">{audit.length} fix(es)</span>
          </div>
          {audit.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-rmpg-400 italic">
              No admin fixes recorded for this scope in this window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Admin</th>
                    <th>Entry</th>
                    <th>Field</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Δ</th>
                    <th>Cascade</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-[10px] text-rmpg-300">
                        {safeDateStr(a.created_at)} {safeTimeStr(a.created_at)}
                      </td>
                      <td className="text-[11px] text-rmpg-200">
                        {a.created_by_name || `user #${a.created_by}`}
                      </td>
                      <td className="font-mono text-[10px]">
                        {a.entry_table === 'calls_for_service' ? `CFS #${a.entry_id}` : `${a.entry_table} #${a.entry_id}`}
                      </td>
                      <td className="font-mono text-[10px] text-rmpg-300">{a.field}</td>
                      <td className="font-mono text-[10px] tabular-nums">
                        {a.before_value == null ? '—' : Number(a.before_value).toLocaleString()}
                      </td>
                      <td className="font-mono text-[10px] tabular-nums">
                        {a.after_value == null ? '—' : Number(a.after_value).toLocaleString()}
                      </td>
                      <td className={`font-mono text-[10px] tabular-nums font-bold ${a.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {a.delta >= 0 ? '+' : ''}{a.delta.toFixed(1)}
                      </td>
                      <td className="font-mono text-[10px] text-amber-300">
                        {a.cascade_count > 0 ? `${a.cascade_count} row(s)` : '—'}
                      </td>
                      <td className="text-[11px] text-rmpg-200 max-w-[280px]">
                        {a.reason || <span className="text-rmpg-500 italic">(no reason)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tripLog && (
        <div className="px-3 py-2 bg-green-950/20 border border-green-700/50 text-[11px] text-green-300 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" />
          FORM PS-211 generated: {tripLog.rows.length} rows · {tripLog.meta.officer_name || '—'} · {tripLog.meta.period.from} → {tripLog.meta.period.to}
        </div>
      )}
    </div>
  );
}
