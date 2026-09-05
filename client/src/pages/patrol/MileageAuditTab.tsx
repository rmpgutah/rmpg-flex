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
  Sparkles,
  Trash2,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateStr, safeTimeStr, parseTimestamp } from '../../utils/dateUtils';
import IconButton from '../../components/IconButton';
import { useToast } from '../../components/ToastProvider';
import TripManagerSection from './TripManagerSection';
import { computeChainGaps, computeNewRowDistance, chainRowKey } from './mileageChainMath';
import { useAuth } from '../../context/AuthContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { renderPdfV2, downloadPdfV2 } from '../../utils/pdf/v2';
import { tripLogSchema, type TripLogData } from '../../utils/pdf/v2/forms/tripLog';
import { useMountedRef } from '../../hooks/useMountedRef';

type ChainRow = {
  id: number;
  // 'call' for calls_for_service rows; 'unit_trip' for standalone PATROL
  // movement merged in from unit_trips (no-call odometer continuity).
  source?: 'call' | 'unit_trip';
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
  /** GPS-recorded distance in METERS (unit_trip rows). Patrol trips usually
   *  have no odometer stamps — this is their distance source. */
  distance_m?: number | null;
  duration_s?: number | null;
  starting_mileage_corrected?: boolean;
  ending_mileage_corrected?: boolean;
  last_fix?: { delta: number; reason: string | null; created_at: string; created_by_name: string | null } | null;
  audit_count?: number;
};

/** Row distance in miles: odometer delta when both readings exist, else the
 *  GPS-recorded distance_m (how odometer-less PATROL trips report). */
const rowDistanceMi = (row: Pick<ChainRow, 'starting_mileage' | 'ending_mileage' | 'distance_m'>): number | null => {
  if (row.starting_mileage != null && row.ending_mileage != null) {
    return Math.max(0, Number(row.ending_mileage) - Number(row.starting_mileage));
  }
  if (row.distance_m != null && row.distance_m > 0) return row.distance_m * 0.000621371;
  return null;
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

/** GET /patrol/mileage/fix-suggestions response — data-derived autofill
 *  candidates (GPS distance, chain-neighbor continuity) for the fix form. */
type FixSuggestions = {
  gps: { distance_mi: number; point_count: number; max_mph: number } | null;
  candidates: Array<{ value: number; source: string; label: string; detail: string }>;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number): string =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const isFixable = (user: { role?: string } | null): boolean =>
  !!user && ['admin', 'manager', 'supervisor'].includes(user.role || '');

export default function MileageAuditTab() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canFix = isFixable(user);
  const isMobile = useIsMobile();

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
  const mountedRef = useMountedRef();

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

  // Data-derived autofill candidates for the open fix form (GPS-recorded
  // distance, chain-neighbor continuity). Fetched per (row, field) from
  // GET /patrol/mileage/fix-suggestions; clicking a chip fills the value.
  const [fixSuggest, setFixSuggest] = useState<FixSuggestions | null>(null);
  const [fixSuggestLoading, setFixSuggestLoading] = useState(false);
  useEffect(() => {
    setFixSuggest(null);
    if (openFixRowId == null || !canFix) return;
    // Suggestions only exist for CFS rows (unit_trip rows are read-only here).
    const row = rows.find((r) => r.id === openFixRowId && (r.source || 'call') === 'call');
    if (!row) return;
    let cancelled = false;
    setFixSuggestLoading(true);
    apiFetch<FixSuggestions>(`/patrol/mileage/fix-suggestions?entry_id=${openFixRowId}&field=${fixField}`)
      .then((s) => { if (!cancelled && mountedRef.current) setFixSuggest(s); })
      .catch(() => { /* chips are an enhancement — the form works without them */ })
      .finally(() => { if (!cancelled && mountedRef.current) setFixSuggestLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFixRowId, fixField, canFix]);

  // Trip log PDF download state
  const [tripLog, setTripLog] = useState<TripLogData | null>(null);
  const [tripLogLoading, setTripLogLoading] = useState(false);

  // Backfill state — inline reason capture so we never use window.prompt()
  // (Electron silently returns null for prompt() — same trap that hid the
  // delete-trip flow before TripManagerSection moved to inline confirmation).
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillReason, setBackfillReason] = useState('');
  const [backfillSubmitting, setBackfillSubmitting] = useState(false);
  // Discard-zero-mile sweep: parallel to backfill, separate reason field so
  // the audit trail explains WHY rows were deleted (a clean-up vs a chain
  // rebuild are distinct operator intents).
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [discardSubmitting, setDiscardSubmitting] = useState(false);
  // Auto-fix gaps: bridges remaining +/- gaps after Rebuild has aligned
  // PATROL forward. Surfaces unbridgeable cases (CFS-to-CFS negative gaps)
  // in the toast so the operator knows what still needs manual /mileage/fix.
  const [autoFixOpen, setAutoFixOpen] = useState(false);
  const [autoFixReason, setAutoFixReason] = useState('');
  const [autoFixSubmitting, setAutoFixSubmitting] = useState(false);
  const [autoFixLastResult, setAutoFixLastResult] = useState<null | {
    bridged_existing: number; synthesized: number; contracted_negative: number;
    unbridgeable_negative: number; oversized_positive: number;
    unbridgeable: Array<{ scope: string; between_cfs_ids: [number, number]; gap_mi: number }>;
  }>(null);

  // ── Load reference data once ──
  useEffect(() => {
    (async () => {
      try {
        // ALL personnel — the old ?role=officer filter hid admins/managers/
        // supervisors who also drive (e.g. the owner), so the dropdown only
        // showed one name. Anyone can hold a mileage chain.
        const u = await apiFetch<any[]>('/personnel');
        setOfficers((Array.isArray(u) ? u : [])
          .map((r: any) => ({ id: r.id, full_name: r.full_name || r.username }))
          .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name))));
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
      try {
        const data = await apiFetch<{ anchor: Anchor; rows: ChainRow[] }>(`/patrol/mileage/chain?${chainParams}`);
        if (!mountedRef.current) return;
        setAnchor(data.anchor || null);
        setRows(data.rows || []);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load chain');
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
    } finally {
      if (mountedRef.current) setLoading(false);
    }
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Fix failed', 'error');
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Trip log generation failed', 'error');
    }
    setTripLogLoading(false);
  };

  const submitBackfill = async () => {
    if (!backfillReason.trim()) {
      addToast('Reason is required for the audit trail', 'error');
      return;
    }
    setBackfillSubmitting(true);
    try {
      const body: Record<string, unknown> = { reason: backfillReason.trim() };
      if (officerId !== '') body.officer_id = Number(officerId);
      if (unitId !== '') body.unit_id = unitId;
      if (from) body.from = from;
      if (to) body.to = to;
      const res = await apiFetch<{ examined_patrol: number; examined_cfs: number; restamped: number; already_consistent: number; skipped: number; outliers: number; errors: string[] }>(
        '/patrol/mileage/backfill-patrol-trips',
        { method: 'POST', body: JSON.stringify(body) },
      );
      addToast(
        `Chain rebuild: ${res.restamped} PATROL rows re-stamped to align with ${res.examined_cfs} CFS rows ` +
        `(${res.already_consistent} already aligned, ${res.skipped} no-anchor, ${res.outliers} outliers)`,
        res.restamped > 0 ? 'success' : 'info',
      );
      setBackfillOpen(false);
      setBackfillReason('');
      refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Backfill failed', 'error');
    } finally {
      setBackfillSubmitting(false);
    }
  };

  const submitAutoFix = async () => {
    if (!autoFixReason.trim()) {
      addToast('Reason is required for the audit trail', 'error');
      return;
    }
    setAutoFixSubmitting(true);
    try {
      const body: Record<string, unknown> = { reason: autoFixReason.trim() };
      if (officerId !== '') body.officer_id = Number(officerId);
      if (unitId !== '') body.unit_id = unitId;
      if (from) body.from = from;
      if (to) body.to = to;
      const res = await apiFetch<{
        bridged_existing: number; synthesized: number; contracted_negative: number;
        unbridgeable_negative: number; oversized_positive: number;
        unbridgeable: Array<{ scope: string; between_cfs_ids: [number, number]; gap_mi: number }>;
        errors: string[];
      }>('/patrol/mileage/auto-fix-gaps', { method: 'POST', body: JSON.stringify(body) });

      const totalFixed = res.bridged_existing + res.synthesized + res.contracted_negative;
      const flags = res.unbridgeable_negative + res.oversized_positive;
      addToast(
        `Auto-fix: ${res.bridged_existing} bridged existing PATROL, ${res.synthesized} synthesized, ` +
        `${res.contracted_negative} contracted (-gaps). ${flags > 0 ? `${flags} flagged for review.` : ''}`,
        totalFixed > 0 ? 'success' : 'info',
      );
      setAutoFixLastResult({
        bridged_existing: res.bridged_existing,
        synthesized: res.synthesized,
        contracted_negative: res.contracted_negative,
        unbridgeable_negative: res.unbridgeable_negative,
        oversized_positive: res.oversized_positive,
        unbridgeable: res.unbridgeable,
      });
      setAutoFixOpen(false);
      setAutoFixReason('');
      refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Auto-fix failed', 'error');
    } finally {
      setAutoFixSubmitting(false);
    }
  };

  const submitDiscard = async () => {
    if (!discardReason.trim()) {
      addToast('Reason is required for the audit trail', 'error');
      return;
    }
    setDiscardSubmitting(true);
    try {
      const body: Record<string, unknown> = { reason: discardReason.trim() };
      if (officerId !== '') body.officer_id = Number(officerId);
      if (unitId !== '') body.unit_id = unitId;
      if (from) body.from = from;
      if (to) body.to = to;
      const res = await apiFetch<{ examined: number; deleted: number; threshold_mi?: number; errors: string[] }>(
        '/patrol/trips/discard-zero-mile',
        { method: 'POST', body: JSON.stringify(body) },
      );
      const threshold = res.threshold_mi ?? 0.5;
      addToast(
        `Discarded ${res.deleted} sub-${threshold}mi PATROL trips (examined ${res.examined})`,
        res.deleted > 0 ? 'success' : 'info',
      );
      setDiscardOpen(false);
      setDiscardReason('');
      refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Discard failed', 'error');
    } finally {
      setDiscardSubmitting(false);
    }
  };

  // Chain-continuity calculation: rows whose starting mileage doesn't pick up
  // where the previous event's ending left off (unrecorded miles, or the
  // odometer going backwards). Keyed by source-qualified row key.
  const chainGaps = useMemo(() => computeChainGaps(rows), [rows]);

  const renderFixForm = (row: ChainRow) => {
    const original = row[fixField as 'starting_mileage' | 'ending_mileage'];
    // A null original means we're backfilling a never-stamped value, not
    // correcting one — there is no delta to propagate down the chain.
    const isBackfill = original == null;
    const previewDelta = (parseFloat(fixAfter) || 0) - (Number(original) || 0);
    const willRewrite = !isBackfill && fixPropagate && previewDelta !== 0;
    // Live calculation: what this row's start→end distance becomes with the
    // entered value, and how it compares to the GPS-recorded distance.
    const afterNum = parseFloat(fixAfter);
    const newDistance = computeNewRowDistance(
      fixField, afterNum,
      row.starting_mileage != null ? Number(row.starting_mileage) : null,
      row.ending_mileage != null ? Number(row.ending_mileage) : null,
    );
    const gpsMi = fixSuggest?.gps?.distance_mi ?? null;
    const gpsDeviation = newDistance != null && gpsMi != null ? Math.round((newDistance - gpsMi) * 10) / 10 : null;
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
                <option value="ending_mileage">Ending Mileage</option>
                <option value="starting_mileage">Starting Mileage</option>
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
            {/* Data-derived autofill: GPS-recorded distance + chain-neighbor
                continuity. One click fills the value; the admin still owns
                the reason + Apply. */}
            <div className="sm:col-span-2 flex items-center gap-1.5 flex-wrap min-h-[20px]">
              {fixSuggestLoading ? (
                <span className="text-[10px] text-rmpg-500 flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" /> computing suggestions…
                </span>
              ) : fixSuggest?.candidates?.length ? (
                <>
                  <span className="text-[9px] text-rmpg-400 uppercase">Autofill:</span>
                  {fixSuggest.candidates.map((s) => (
                    <button
                      key={`${s.source}-${s.value}`}
                      type="button"
                      onClick={() => setFixAfter(String(s.value))}
                      title={s.detail}
                      className={`toolbar-btn text-[10px] font-mono ${parseFloat(fixAfter) === s.value ? 'text-brand-300' : ''}`}
                    >
                      {Number(s.value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      <span className="text-rmpg-400 ml-1 font-sans normal-case">{s.label}</span>
                    </button>
                  ))}
                </>
              ) : fixSuggest ? (
                <span className="text-[10px] text-rmpg-500 italic">No GPS or chain-neighbor data to suggest from.</span>
              ) : null}
            </div>
            {/* Live calculation: resulting row distance + deviation vs GPS. */}
            {(newDistance != null || gpsMi != null) && (
              <div className="sm:col-span-2 flex items-center gap-3 text-[10px] font-mono">
                {newDistance != null && (
                  <span className={newDistance < 0 ? 'text-red-400 font-bold' : 'text-rmpg-200'}>
                    Row distance becomes {newDistance.toFixed(1)} mi
                    {newDistance < 0 && ' — odometer would run backwards'}
                  </span>
                )}
                {gpsMi != null && (
                  <span className="text-rmpg-400" title={`Summed from ${fixSuggest!.gps!.point_count} GPS breadcrumbs over the call window`}>
                    GPS recorded {gpsMi.toFixed(1)} mi
                    {gpsDeviation != null && Math.abs(gpsDeviation) > 0.5 && (
                      <span className="text-amber-400"> (Δ {gpsDeviation >= 0 ? '+' : ''}{gpsDeviation.toFixed(1)})</span>
                    )}
                  </span>
                )}
              </div>
            )}
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
      const d = rowDistanceMi(r);
      if (d != null) distance += d;
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
      {/* Sticky below the patrol sub-tab nav (z-30) so changing officer/unit/
          dates doesn't require scrolling back up past hundreds of chain rows.
          top-9 sits the picker right under the Spillman tab strip. */}
      <div className="panel-beveled bg-surface-base p-3 sticky top-9 z-20">
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
            {canFix && (
              <button
                type="button"
                onClick={() => { setBackfillOpen((v) => !v); setDiscardOpen(false); setAutoFixOpen(false); }}
                className="toolbar-btn text-[10px]"
                disabled={backfillSubmitting}
                title="Walk the unified CFS+PATROL chain and re-stamp PATROL odometer to align with CFS observations in this scope/window"
              >
                <Wand2 className="w-3 h-3" />
                Rebuild chain
              </button>
            )}
            {canFix && (
              <button
                type="button"
                onClick={() => { setDiscardOpen((v) => !v); setBackfillOpen(false); setAutoFixOpen(false); }}
                className="toolbar-btn text-[10px]"
                disabled={discardSubmitting}
                title="Delete sub-0.5-mile PATROL trips (parking-lot shuffle, engine-on-while-parked, single-fix sweep noise) from this scope/window"
              >
                <Trash2 className="w-3 h-3" />
                Discard ≤0.5 mi
              </button>
            )}
            {canFix && (
              <button
                type="button"
                onClick={() => { setAutoFixOpen((v) => !v); setBackfillOpen(false); setDiscardOpen(false); }}
                className="toolbar-btn text-[10px]"
                disabled={autoFixSubmitting}
                title="Close remaining +/- gaps: chain existing PATROL trips between CFS rows, synthesize gap-fill trips where no PATROL exists, contract PATROL ends down to CFS observations. CFS rows never auto-edited."
              >
                <Sparkles className="w-3 h-3" />
                Auto-fix gaps
              </button>
            )}
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
        {backfillOpen && canFix && (
          <div className="mt-2 px-2 py-2 bg-surface-sunken border border-amber-700/40 flex items-center gap-2">
            <span className="text-[10px] text-amber-300 font-mono uppercase tracking-wider">
              Rebuild
            </span>
            <input
              type="text"
              autoFocus
              value={backfillReason}
              onChange={(e) => setBackfillReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitBackfill(); }}
              placeholder="Reason (e.g. align PATROL chain to CFS observations)"
              className="input-dark flex-1 min-h-[28px] text-xs"
            />
            <button
              type="button"
              onClick={submitBackfill}
              disabled={backfillSubmitting || !backfillReason.trim()}
              className="toolbar-btn toolbar-btn-primary text-[10px]"
            >
              {backfillSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              Rebuild on current scope/window
            </button>
            <IconButton
              aria-label="Cancel rebuild"
              onClick={() => { setBackfillOpen(false); setBackfillReason(''); }}
              className="text-rmpg-400 hover:text-rmpg-100"
            >
              <X className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
        {autoFixOpen && canFix && (
          <div className="mt-2 px-2 py-2 bg-surface-sunken border border-purple-700/40 flex items-center gap-2">
            <span className="text-[10px] text-purple-300 font-mono uppercase tracking-wider">
              Auto-fix
            </span>
            <input
              type="text"
              autoFocus
              value={autoFixReason}
              onChange={(e) => setAutoFixReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAutoFix(); }}
              placeholder="Reason (e.g. close residual gaps after Rebuild — synthesize missing PATROL records)"
              className="input-dark flex-1 min-h-[28px] text-xs"
            />
            <button
              type="button"
              onClick={submitAutoFix}
              disabled={autoFixSubmitting || !autoFixReason.trim()}
              className="toolbar-btn toolbar-btn-primary text-[10px]"
            >
              {autoFixSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Auto-fix on current scope/window
            </button>
            <IconButton
              aria-label="Cancel auto-fix"
              onClick={() => { setAutoFixOpen(false); setAutoFixReason(''); }}
              className="text-rmpg-400 hover:text-rmpg-100"
            >
              <X className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
        {autoFixLastResult && (autoFixLastResult.unbridgeable.length > 0 || autoFixLastResult.oversized_positive > 0) && (
          <div className="mt-2 px-2 py-2 bg-surface-sunken border border-amber-700/40">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] text-amber-300 font-mono uppercase tracking-wider">
                Auto-fix flagged for manual review
              </span>
              <IconButton
                aria-label="Dismiss review panel"
                onClick={() => setAutoFixLastResult(null)}
                className="ml-auto text-rmpg-400 hover:text-rmpg-100"
              >
                <X className="w-3.5 h-3.5" />
              </IconButton>
            </div>
            {autoFixLastResult.oversized_positive > 0 && (
              <div className="text-[10px] text-amber-300 mb-1">
                {autoFixLastResult.oversized_positive} gap(s) over 100 mi — too large to safely synthesize, likely data corruption. Use the per-row Fix tool.
              </div>
            )}
            {autoFixLastResult.unbridgeable.length > 0 && (
              <div>
                <div className="text-[10px] text-amber-300 mb-0.5">
                  CFS-to-CFS negative gaps (odometer entered lower than prior call's end — needs human judgment about which row is wrong):
                </div>
                <ul className="text-[10px] font-mono text-rmpg-200 space-y-0.5 max-h-32 overflow-y-auto">
                  {autoFixLastResult.unbridgeable.map((u, i) => (
                    <li key={i}>
                      between CFS {u.between_cfs_ids[0]} and CFS {u.between_cfs_ids[1]}: {u.gap_mi.toFixed(1)} mi
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {discardOpen && canFix && (
          <div className="mt-2 px-2 py-2 bg-surface-sunken border border-red-700/40 flex items-center gap-2">
            <span className="text-[10px] text-red-300 font-mono uppercase tracking-wider">
              Discard ≤0.5 mi
            </span>
            <input
              type="text"
              autoFocus
              value={discardReason}
              onChange={(e) => setDiscardReason(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitDiscard(); }}
              placeholder="Reason (e.g. parked-engine-running noise from before noise-filter fix)"
              className="input-dark flex-1 min-h-[28px] text-xs"
            />
            <button
              type="button"
              onClick={submitDiscard}
              disabled={discardSubmitting || !discardReason.trim()}
              className="toolbar-btn text-[10px] !text-red-300 hover:!text-red-200"
            >
              {discardSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Delete on current scope/window
            </button>
            <IconButton
              aria-label="Cancel discard"
              onClick={() => { setDiscardOpen(false); setDiscardReason(''); }}
              className="text-rmpg-400 hover:text-rmpg-100"
            >
              <X className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        )}
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
        ) : isMobile ? (
          // Mobile: render the chain as cards. A 6-column wide table
          // with inline fix forms is impossible on a phone; cards stack
          // the key fields vertically and tap-toggle the fix form.
          <div className="space-y-2 p-2">
            {rows.map((row) => {
              const sm = row.starting_mileage;
              const em = row.ending_mileage;
              const distMi = rowDistanceMi(row);
              const distance = distMi != null ? distMi.toFixed(1) : '—';
              const cleared = row.cleared_at || row.closed_at;
              const isOpen = openFixRowId === row.id;
              const corrected = row.ending_mileage_corrected || row.starting_mileage_corrected;
              const isTrip = row.source === 'unit_trip';
              const gap = chainGaps.get(chainRowKey(row));
              return (
                <div
                  key={chainRowKey(row)}
                  className={`panel-beveled p-2 ${
                    corrected ? 'bg-amber-950/20' : isTrip ? 'bg-surface-sunken' : 'bg-surface-raised'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={`font-mono text-[12px] truncate ${isTrip ? 'text-[var(--brand-gold)]' : 'text-rmpg-100'}`}>
                        {row.call_number || `#${row.id}`}
                      </span>
                      {corrected && (
                        <span title="Corrected" className="text-amber-400 flex-shrink-0">
                          <Pencil className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-rmpg-400 flex-shrink-0 ml-2">
                      {cleared ? `${safeDateStr(cleared)} ${safeTimeStr(cleared)}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase text-rmpg-400 mb-1">
                    <span className="truncate">{row.incident_type || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-rmpg-100">
                      {sm != null ? Number(sm).toLocaleString() : '—'}
                      <span className="text-rmpg-500 mx-1">→</span>
                      {em != null ? Number(em).toLocaleString() : '—'}
                      {gap && (
                        <span
                          className={`ml-1.5 text-[9px] font-bold ${gap.gap < 0 ? 'text-red-400' : 'text-amber-400'}`}
                          title={`Chain gap: starts ${Math.abs(gap.gap).toFixed(1)} mi ${gap.gap < 0 ? 'BELOW' : 'above'} where ${gap.prevRef} ended${gap.gap < 0 ? ' — odometer went backwards' : ' (unrecorded movement)'}`}
                        >
                          {gap.gap >= 0 ? '+' : ''}{gap.gap.toFixed(1)} gap
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-brand-400">{distance} mi</span>
                  </div>
                  <div className="mt-2 pt-1 border-t border-rmpg-700/50 flex justify-end print:hidden">
                    {canFix && !isTrip ? (
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
                      <span className="text-[10px] text-rmpg-500">
                        {isTrip ? 'PATROL · read-only' : '—'}
                      </span>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-2 pt-2 border-t border-rmpg-700/50">
                      {/* renderFixForm returns a <tr>; on mobile we wrap
                          it in a table so the rendered cells still lay out
                          (the form is intricate; rewriting it for cards
                          would risk drift from the desktop behavior). */}
                      <table className="table-dark w-full">
                        <tbody>{renderFixForm(row)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                  const distMi = rowDistanceMi(row);
                  const distance = distMi != null ? distMi.toFixed(1) : '—';
                  const cleared = row.cleared_at || row.closed_at;
                  const isOpen = openFixRowId === row.id;
                  const gap = chainGaps.get(chainRowKey(row));
                  return (
                    <React.Fragment key={chainRowKey(row)}>
                      <tr className={
                        row.ending_mileage_corrected || row.starting_mileage_corrected
                          ? 'bg-amber-950/20'
                          : row.source === 'unit_trip'
                            ? 'bg-surface-sunken'
                            : ''
                      }>
                        <td className="font-mono text-[10px] text-rmpg-300">
                          {cleared ? `${safeDateStr(cleared)} ${safeTimeStr(cleared)}` : '—'}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            <span className={`font-mono text-[11px] ${row.source === 'unit_trip' ? 'text-[var(--brand-gold)]' : 'text-rmpg-100'}`}>
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
                          {gap && (
                            <span
                              className={`ml-1.5 text-[9px] font-bold ${gap.gap < 0 ? 'text-red-400' : 'text-amber-400'}`}
                              title={`Chain gap: starts ${Math.abs(gap.gap).toFixed(1)} mi ${gap.gap < 0 ? 'BELOW' : 'above'} where ${gap.prevRef} ended${gap.gap < 0 ? ' — odometer went backwards' : ' (unrecorded movement)'}`}
                            >
                              {gap.gap >= 0 ? '+' : ''}{gap.gap.toFixed(1)} gap
                            </span>
                          )}
                        </td>
                        <td className="font-mono text-[11px] tabular-nums text-brand-400">
                          {distance} mi
                        </td>
                        <td className="print:hidden">
                          {/* unit_trip rows are read-only here — /mileage/fix
                              targets calls_for_service. Patrol-trip mileage
                              corrections are made through the trip's own UI. */}
                          {canFix && row.source !== 'unit_trip' ? (
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
                            <span className="text-[10px] text-rmpg-500" title={row.source === 'unit_trip' ? 'Patrol trip (read-only in audit)' : ''}>
                              {row.source === 'unit_trip' ? 'PATROL' : '—'}
                            </span>
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
          ) : isMobile ? (
            // Mobile: card per audit entry. A 9-column table is unreadable
            // on a phone. Group by visual hierarchy — admin + when in the
            // header, entry/field on the second line, mileage delta and
            // cascade on the third, reason in a paragraph beneath.
            <div className="space-y-2 p-2">
              {audit.map((a) => (
                <div key={a.id} className="panel-beveled bg-surface-raised p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-rmpg-200 truncate">
                      {a.created_by_name || `user #${a.created_by}`}
                    </span>
                    <span className="font-mono text-[10px] text-rmpg-400 flex-shrink-0 ml-2">
                      {safeDateStr(a.created_at)} {safeTimeStr(a.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-rmpg-300 mb-1">
                    <span className="font-mono truncate">
                      {a.entry_table === 'calls_for_service' ? `CFS #${a.entry_id}` : `${a.entry_table} #${a.entry_id}`}
                    </span>
                    <span className="font-mono uppercase">{a.field}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[11px] tabular-nums text-rmpg-200">
                      {a.before_value == null ? '—' : Number(a.before_value).toLocaleString()}
                      <span className="text-rmpg-500 mx-1">→</span>
                      {a.after_value == null ? '—' : Number(a.after_value).toLocaleString()}
                    </span>
                    <span className={`font-mono text-[11px] tabular-nums font-bold ${a.delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {a.delta >= 0 ? '+' : ''}{a.delta.toFixed(1)}
                    </span>
                  </div>
                  {a.cascade_count > 0 && (
                    <div className="text-[10px] text-amber-300 mb-1">Cascade: {a.cascade_count} row(s)</div>
                  )}
                  <div className="text-[11px] text-rmpg-200 pt-1 border-t border-rmpg-700/50">
                    {a.reason || <span className="text-rmpg-500 italic">(no reason)</span>}
                  </div>
                </div>
              ))}
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

      {/* Full trip CRUD — every logged trip (dispatch unit_trips + nav
          nav_trip_log) with add/edit/delete for admin/manager/supervisor.
          Mutations refresh the chain + audit panels via refresh(). */}
      <TripManagerSection
        officerId={officerId}
        unitId={unitId}
        from={from}
        to={to}
        canEdit={canFix}
        onChanged={refresh}
      />

      {tripLog && (
        <div className="px-3 py-2 bg-green-950/20 border border-green-700/50 text-[11px] text-green-300 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5" />
          FORM PS-211 generated: {tripLog.rows.length} rows · {tripLog.meta.officer_name || '—'} · {tripLog.meta.period.from} → {tripLog.meta.period.to}
        </div>
      )}
    </div>
  );
}
