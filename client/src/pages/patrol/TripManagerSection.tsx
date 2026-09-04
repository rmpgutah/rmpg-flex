// ============================================================
// TripManagerSection — full trip CRUD for the Patrol surface
// ============================================================
// Lists EVERY logged trip in the scope/window from both trip
// systems (unit_trips via the dispatch trip engine + nav_trip_log
// via the nav detector) and lets admin/manager/supervisor edit,
// add, or delete rows. Every mutation requires a reason and is
// written to mileage_audit by the Worker (see /patrol/trips in
// src/routes/patrolMileage.ts).

import { useCallback, useEffect, useState } from 'react';
import { Route, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import IconButton from '../../components/IconButton';

export interface ManagedTrip {
  id: number;
  source: 'unit' | 'nav';
  trip_type: 'patrol' | 'call_response';
  status: string | null;
  call_number: string | null;
  officer_id: number | null;
  unit_id: number | null;
  start_time: string | null;
  end_time: string | null;
  start_mileage: number | null;
  end_mileage: number | null;
  distance_mi: number | null;
  duration_s: number | null;
  max_speed: number | null;
}

interface Props {
  officerId: string | number | '';
  unitId: number | '';
  from: string;
  to: string;
  canEdit: boolean;
  /** bump to force a refetch (e.g. after a chain fix) */
  refreshKey?: number;
  /** notify the parent that trips changed (so the chain/audit can refresh) */
  onChanged?: () => void;
}

const tsLocal = (iso: string | null): string => {
  if (!iso) return '—';
  const s = String(iso).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Denver',
  });
};

// datetime-local input value (Denver wall clock) ⇄ naive-UTC DB string
const toInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const s = String(iso).replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
};
const fromInputValue = (v: string): string | null => {
  if (!v) return null;
  // Interpret the wall-clock value as America/Denver and store naive UTC.
  const probe = new Date(`${v}:00Z`);
  if (Number.isNaN(probe.getTime())) return null;
  const denverAtProbe = new Date(probe.toLocaleString('en-US', { timeZone: 'America/Denver' }));
  const offsetMs = probe.getTime() - denverAtProbe.getTime();
  const utc = new Date(probe.getTime() + offsetMs);
  return utc.toISOString().slice(0, 19).replace('T', ' ');
};

interface DraftTrip {
  trip_type: 'patrol' | 'call_response';
  call_number: string;
  start_local: string;
  end_local: string;
  start_mileage: string;
  end_mileage: string;
  distance_mi: string;
  reason: string;
}
const emptyDraft = (): DraftTrip => ({
  trip_type: 'patrol', call_number: '', start_local: '', end_local: '',
  start_mileage: '', end_mileage: '', distance_mi: '', reason: '',
});

export default function TripManagerSection({ officerId, unitId, from, to, canEdit, refreshKey, onChanged }: Props) {
  const { addToast } = useToast();
  const [trips, setTrips] = useState<ManagedTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null); // `${source}:${id}`
  const [draft, setDraft] = useState<DraftTrip>(emptyDraft());
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  // Inline delete confirmation (key + reason) — replaces window.prompt.
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (officerId !== '') params.set('officer_id', String(officerId));
      if (unitId !== '') params.set('unit_id', String(unitId));
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const data = await apiFetch<{ trips: ManagedTrip[] }>(`/patrol/trips?${params}`);
      setTrips(data.trips || []);
    } catch {
      addToast('Failed to load trips', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officerId, unitId, from, to]);

  useEffect(() => { fetchTrips(); }, [fetchTrips, refreshKey]);

  // Pre-fill draft.start_mileage from the (officer, unit) anchor when the
  // operator clicks +Add Trip. Removes the manual "look up the last
  // odometer and type it in" step that nobody bothers with — that's why
  // every PATROL row in the trip log has been "—" / "—" for months.
  // Returns the suggested number so submitAdd can pre-fill end_mileage
  // when the user types only a distance.
  const fetchSuggestedMileage = useCallback(async (): Promise<number | null> => {
    if (officerId === '' && unitId === '') return null;
    const params = new URLSearchParams();
    if (officerId !== '') params.set('officer_id', String(officerId));
    if (unitId !== '') params.set('unit_id', String(unitId));
    try {
      const res = await apiFetch<{ suggested_mileage: number | null }>(`/patrol/mileage/suggest?${params}`);
      return res?.suggested_mileage ?? null;
    } catch { return null; }
  }, [officerId, unitId]);

  const startAdd = async () => {
    setEditingKey(null);
    setAdding(true);
    const seed = emptyDraft();
    const suggested = await fetchSuggestedMileage();
    if (suggested != null) seed.start_mileage = String(Math.round(suggested * 10) / 10);
    setDraft(seed);
  };

  const startEdit = (t: ManagedTrip) => {
    setAdding(false);
    setEditingKey(`${t.source}:${t.id}`);
    setDraft({
      trip_type: t.trip_type === 'call_response' ? 'call_response' : 'patrol',
      call_number: t.call_number ?? '',
      start_local: toInputValue(t.start_time),
      end_local: toInputValue(t.end_time),
      start_mileage: t.start_mileage != null ? String(t.start_mileage) : '',
      end_mileage: t.end_mileage != null ? String(t.end_mileage) : '',
      distance_mi: t.distance_mi != null ? String(t.distance_mi) : '',
      reason: '',
    });
  };

  const cancelDraft = () => { setEditingKey(null); setAdding(false); setDraft(emptyDraft()); setSubmitting(false); };

  const draftBody = (): Record<string, unknown> | null => {
    if (!draft.reason.trim()) { addToast('Reason is required for the audit trail', 'error'); return null; }
    const body: Record<string, unknown> = { reason: draft.reason.trim() };
    body.trip_type = draft.trip_type;
    if (draft.call_number.trim()) body.call_number = draft.call_number.trim();
    const st = fromInputValue(draft.start_local);
    const en = fromInputValue(draft.end_local);
    if (st) body.start_time = st;
    if (en) body.end_time = en;
    if (draft.start_mileage !== '') body.start_mileage = parseFloat(draft.start_mileage);
    if (draft.end_mileage !== '') body.end_mileage = parseFloat(draft.end_mileage);
    if (draft.distance_mi !== '') body.distance_mi = parseFloat(draft.distance_mi);
    return body;
  };

  const submitEdit = async (t: ManagedTrip) => {
    const body = draftBody();
    if (!body) return;
    setSubmitting(true);
    try {
      await apiFetch(`/patrol/trips/${t.source}/${t.id}`, { method: 'PUT', body: JSON.stringify(body) });
      addToast('Trip updated', 'success');
      cancelDraft();
      fetchTrips();
      onChanged?.();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Update failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAdd = async () => {
    const body = draftBody();
    if (!body) return;
    if (!body.start_time) { addToast('Start time is required', 'error'); return; }
    if (officerId !== '') body.officer_id = Number(officerId);
    if (unitId !== '') body.unit_id = unitId;
    setSubmitting(true);
    try {
      await apiFetch('/patrol/trips', { method: 'POST', body: JSON.stringify(body) });
      addToast('Trip added', 'success');
      cancelDraft();
      fetchTrips();
      onChanged?.();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Add failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // NOTE: no window.prompt here — Electron doesn't implement prompt()
  // (returns null silently) and Chrome can suppress it, so the original
  // prompt-based delete looked completely dead ("cannot delete records on
  // Patrol"). The reason is collected with an inline row instead.
  const submitDelete = async (t: ManagedTrip, reason: string) => {
    if (!reason.trim()) { addToast('Reason is required for the audit trail', 'error'); return; }
    setDeletingKey(`${t.source}:${t.id}`);
    try {
      await apiFetch(`/patrol/trips/${t.source}/${t.id}?reason=${encodeURIComponent(reason.trim())}`, { method: 'DELETE' });
      addToast('Trip deleted', 'success');
      setConfirmDeleteKey(null);
      setDeleteReason('');
      fetchTrips();
      onChanged?.();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeletingKey(null);
    }
  };

  const draftFields = () => (
    <tr className="bg-surface-sunken border-b border-rmpg-700">
      <td className="px-2 py-1">
        <select
          value={draft.trip_type}
          onChange={(e) => setDraft({ ...draft, trip_type: e.target.value as DraftTrip['trip_type'] })}
          className="bg-surface-base border border-rmpg-700 text-[10px] px-1 py-0.5 w-full"
        >
          <option value="patrol">PATROL</option>
          <option value="call_response">RESPONSE</option>
        </select>
      </td>
      <td className="px-2 py-1">
        <input value={draft.call_number} onChange={(e) => setDraft({ ...draft, call_number: e.target.value })}
          placeholder="CFS26-…" className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-full" />
      </td>
      <td className="px-2 py-1" colSpan={2}>
        <div className="flex gap-1 items-center">
          <input type="datetime-local" value={draft.start_local} onChange={(e) => setDraft({ ...draft, start_local: e.target.value })}
            className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5" />
          <span className="text-fg-muted text-[9px]">→</span>
          <input type="datetime-local" value={draft.end_local} onChange={(e) => setDraft({ ...draft, end_local: e.target.value })}
            className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5" />
        </div>
      </td>
      <td className="px-2 py-1">
        <input value={draft.distance_mi} onChange={(e) => setDraft({ ...draft, distance_mi: e.target.value })}
          placeholder="mi" inputMode="decimal" className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-16 text-right" />
      </td>
      <td className="px-2 py-1" colSpan={2}>
        <div className="flex gap-1 items-center">
          <input value={draft.start_mileage} onChange={(e) => setDraft({ ...draft, start_mileage: e.target.value })}
            placeholder="odo from" inputMode="decimal" className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-20 text-right" />
          <span className="text-fg-muted text-[9px]">→</span>
          <input value={draft.end_mileage} onChange={(e) => setDraft({ ...draft, end_mileage: e.target.value })}
            placeholder="odo to" inputMode="decimal" className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-20 text-right" />
        </div>
      </td>
      <td className="px-2 py-1" colSpan={2}>
        <div className="flex gap-1 items-center">
          <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            placeholder="Reason (required, audited)" className="bg-surface-base border border-amber-700/60 text-[10px] px-1 py-0.5 flex-1" />
          <IconButton
            aria-label="Save new trip"
            onClick={submitAdd}
            className="text-green-400 hover:text-green-300"
            disabled={submitting}
          >
            <Check className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton aria-label="Cancel" onClick={cancelDraft} className="text-fg-muted hover:text-rmpg-100">
            <X className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="bg-surface-base border border-border-default rounded-[2px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <h4 className="text-[9px] [color:var(--panel-header-color)] uppercase font-bold tracking-wider flex items-center gap-1.5">
          <Route className="w-3 h-3" /> Trip Log Management ({trips.length})
        </h4>
        {canEdit && (
          <button
            onClick={startAdd}
            className="flex items-center gap-1 text-[9px] uppercase font-bold tracking-wider px-2 py-1 bg-surface-raised border border-rmpg-700 [color:var(--panel-header-color)] hover:bg-surface-raised transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Trip
          </button>
        )}
      </div>
      {loading ? (
        <div className="h-[60px] flex items-center justify-center text-[10px] text-fg-muted">Loading trips…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-fg-muted uppercase text-[9px] tracking-wider border-b border-border-default font-semibold">
                <th className="text-left px-2 py-[3px]">Type</th>
                <th className="text-left px-2 py-[3px]">Call #</th>
                <th className="text-left px-2 py-[3px]">Start</th>
                <th className="text-left px-2 py-[3px]">End</th>
                <th className="text-right px-2 py-[3px]">Dist (mi)</th>
                <th className="text-right px-2 py-[3px]">Odo From</th>
                <th className="text-right px-2 py-[3px]">Odo To</th>
                <th className="text-left px-2 py-[3px]">Source</th>
                <th className="text-right px-2 py-[3px]">{canEdit ? 'Actions' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {adding && draftFields()}
              {trips.length === 0 && !adding && (
                <tr><td colSpan={9} className="text-center py-4 text-[10px] text-fg-muted">No trips in this scope/window</td></tr>
              )}
              {trips.map((t) => {
                const key = `${t.source}:${t.id}`;
                if (editingKey === key) {
                  return (
                    <tr key={key} className="bg-surface-sunken border-b border-rmpg-700">
                      <td className="px-2 py-1">
                        <select value={draft.trip_type} disabled={t.source === 'nav'}
                          onChange={(e) => setDraft({ ...draft, trip_type: e.target.value as DraftTrip['trip_type'] })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] px-1 py-0.5">
                          <option value="patrol">PATROL</option>
                          <option value="call_response">RESPONSE</option>
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input value={draft.call_number} disabled={t.source === 'nav'}
                          onChange={(e) => setDraft({ ...draft, call_number: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-24" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="datetime-local" value={draft.start_local}
                          onChange={(e) => setDraft({ ...draft, start_local: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="datetime-local" value={draft.end_local}
                          onChange={(e) => setDraft({ ...draft, end_local: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input value={draft.distance_mi} inputMode="decimal"
                          onChange={(e) => setDraft({ ...draft, distance_mi: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-16 text-right" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input value={draft.start_mileage} inputMode="decimal" disabled={t.source === 'nav'}
                          onChange={(e) => setDraft({ ...draft, start_mileage: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-20 text-right disabled:opacity-40" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input value={draft.end_mileage} inputMode="decimal" disabled={t.source === 'nav'}
                          onChange={(e) => setDraft({ ...draft, end_mileage: e.target.value })}
                          className="bg-surface-base border border-rmpg-700 text-[10px] font-mono px-1 py-0.5 w-20 text-right disabled:opacity-40" />
                      </td>
                      <td className="px-2 py-1" colSpan={2}>
                        <div className="flex gap-1 items-center justify-end">
                          <input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                            placeholder="Reason (required)" className="bg-surface-base border border-amber-700/60 text-[10px] px-1 py-0.5 w-44" />
                          <IconButton aria-label="Save trip changes" onClick={() => submitEdit(t)} disabled={submitting}
                            className="text-green-400 hover:text-green-300">
                            <Check className="w-3.5 h-3.5" />
                          </IconButton>
                          <IconButton aria-label="Cancel edit" onClick={cancelDraft} className="text-fg-muted hover:text-rmpg-100">
                            <X className="w-3.5 h-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                }
                if (confirmDeleteKey === key) {
                  return (
                    <tr key={key} className="bg-red-950/20 border-b border-red-900/40">
                      <td className="px-2 py-1 font-mono font-bold text-[10px] text-red-400" colSpan={4}>
                        DELETE {t.trip_type === 'call_response' ? 'RESPONSE' : 'PATROL'} trip · {tsLocal(t.start_time)} → {tsLocal(t.end_time)}
                      </td>
                      <td className="px-2 py-1" colSpan={5}>
                        <div className="flex gap-1 items-center justify-end">
                          <input
                            value={deleteReason}
                            onChange={(e) => setDeleteReason(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitDelete(t, deleteReason); }}
                            placeholder="Reason (required, audited)"
                            autoFocus
                            className="bg-surface-base border border-red-700/60 text-[10px] px-1 py-0.5 w-56"
                          />
                          <button
                            type="button"
                            onClick={() => submitDelete(t, deleteReason)}
                            disabled={deletingKey === key}
                            className="text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 bg-red-900/40 border border-red-700/60 text-red-300 hover:bg-red-900/70 transition-colors disabled:opacity-50"
                          >
                            {deletingKey === key ? 'Deleting…' : 'Confirm Delete'}
                          </button>
                          <IconButton aria-label="Cancel delete" onClick={() => { setConfirmDeleteKey(null); setDeleteReason(''); }} className="text-fg-muted hover:text-rmpg-100">
                            <X className="w-3.5 h-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={key} className="border-b border-border-default hover:bg-surface-sunken transition-colors">
                    <td className={`px-2 py-[2px] font-mono font-bold text-[10px] ${t.trip_type === 'call_response' ? '[color:var(--panel-header-color)]' : 'text-fg-muted'}`}>
                      {t.trip_type === 'call_response' ? 'RESPONSE' : 'PATROL'}
                    </td>
                    <td className="px-2 py-[2px] font-mono text-[10px] text-fg-muted">{t.call_number || '—'}</td>
                    <td className="px-2 py-[2px] font-mono text-[10px] tabular-nums text-rmpg-200">{tsLocal(t.start_time)}</td>
                    <td className="px-2 py-[2px] font-mono text-[10px] tabular-nums text-rmpg-200">{tsLocal(t.end_time)}</td>
                    <td className="px-2 py-[2px] font-mono text-[10px] tabular-nums text-right text-rmpg-100">
                      {t.distance_mi != null ? t.distance_mi.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-[2px] font-mono text-[10px] tabular-nums text-right text-fg-muted">
                      {t.start_mileage != null ? Number(t.start_mileage).toLocaleString() : '—'}
                    </td>
                    <td className="px-2 py-[2px] font-mono text-[10px] tabular-nums text-right text-fg-muted">
                      {t.end_mileage != null ? Number(t.end_mileage).toLocaleString() : '—'}
                    </td>
                    <td className="px-2 py-[2px] text-[9px] uppercase text-fg-muted">{t.source === 'nav' ? 'NAV' : 'DISPATCH'}</td>
                    <td className="px-2 py-[2px] text-right">
                      {canEdit && (
                        <span className="inline-flex gap-1">
                          <IconButton aria-label={`Edit trip ${t.id}`} onClick={() => startEdit(t)} className="text-fg-muted hover:[color:var(--panel-header-color)]">
                            <Pencil className="w-3 h-3" />
                          </IconButton>
                          <IconButton aria-label={`Delete trip ${t.id}`}
                            onClick={() => { setEditingKey(null); setAdding(false); setConfirmDeleteKey(key); setDeleteReason(''); }}
                            disabled={deletingKey === key} className="text-fg-muted hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </IconButton>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit && (
        <div className="px-3 py-1.5 border-t border-border-default text-[9px] text-fg-muted">
          Read-only — trip edits require admin / manager / supervisor.
        </div>
      )}
    </div>
  );
}
