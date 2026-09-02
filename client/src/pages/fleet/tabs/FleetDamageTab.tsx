import { useState, useEffect } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { useToast } from '../../../components/ToastProvider';
import ConfirmDialog from '../../../components/ConfirmDialog';
import FloatingSaveBar from '../../../components/FloatingSaveBar';
import UnsavedChangesGuard from '../../../components/UnsavedChangesGuard';
import { localToday, parseTimestamp } from '../../../utils/dateUtils';
import { formatEnumValue, toDisplayLabel } from '../../../utils/formatters';

import RichTextArea from '../../../components/RichTextArea';
interface DamageReport {
  id: number;
  vehicle_id: number;
  reported_by_name: string;
  damage_date: string;
  damage_type: string;
  location_on_vehicle: string;
  severity: string;
  description: string;
  repair_estimate: number;
  repair_cost: number;
  repair_status: string;
  insurance_claim_number: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  minor: 'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50',
  moderate: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  major: 'bg-red-900/50 text-red-400 border border-red-700/50',
  totaled: 'bg-red-900/70 text-red-300 border border-red-600/50',
};

const REPAIR_COLORS: Record<string, string> = {
  reported: 'text-rmpg-400', estimated: 'text-amber-400', approved: 'text-purple-400',
  in_repair: 'text-rmpg-400', completed: 'text-green-400', insurance_claim: 'text-amber-400',
};

export default function FleetDamageTab({ vehicleId }: { vehicleId: number | string }) {
  const { addToast } = useToast();
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DamageReport | null>(null);
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft({
    storageKey: `rmpg_fleet_damage_form_${editingId ?? 'new'}`,
    defaultValue: {
      damage_date: localToday(), damage_type: '', location_on_vehicle: '',
      severity: 'minor', description: '', repair_estimate: '',
    },
    isActive: showForm,
  });
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<DamageReport[]>(`/fleet/${vehicleId}/damage-reports`); setReports(Array.isArray(data) ? data : []);
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to load damage reports', 'error'); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [vehicleId]);

  // Snapshot initial form state as clean baseline when form opens
  useEffect(() => {
    if (showForm) snapshot();
  }, [showForm]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { clearDraft(); setShowForm(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.damage_type.trim()) { addToast('Damage type is required', 'error'); return; }
    if (!form.description.trim()) { addToast('Description is required', 'error'); return; }
    if (submitting) return;
    setSubmitting(true);
    // Map UI fields to handler columns (location / repair_cost).
    const payload = {
      damage_date: form.damage_date,
      damage_type: form.damage_type,
      location: form.location_on_vehicle || null,
      severity: form.severity,
      description: form.description,
      repair_cost: form.repair_estimate ? Number(form.repair_estimate) : null,
    };
    try {
      if (editingId != null) {
        await apiFetch(`/fleet/damage-reports/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Damage report updated', 'success');
      } else {
        await apiFetch(`/fleet/${vehicleId}/damage-reports`, { method: 'POST', body: JSON.stringify(payload) });
        addToast('Damage reported', 'success');
      }
      clearDraft(); setShowForm(false); setEditingId(null); load();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to save damage report', 'error'); } finally { setSubmitting(false); }
  };

  const startEdit = (r: DamageReport) => {
    setForm(() => ({
      damage_date: (r.damage_date || '').slice(0, 10) || localToday(),
      damage_type: r.damage_type || '',
      location_on_vehicle: r.location_on_vehicle || (r as any).location || '',
      severity: r.severity || 'minor',
      description: r.description || '',
      repair_estimate: r.repair_cost != null ? String(r.repair_cost) : '',
    }));
    setEditingId(r.id);
    setShowForm(true);
  };

  const handleDelete = async (r: DamageReport) => {
    try { await apiFetch(`/fleet/damage/${r.id}`, { method: 'DELETE' }); addToast('Damage report deleted', 'success'); load(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Failed to delete report', 'error'); }
  };

  const updateRepairStatus = async (id: number, repair_status: string) => {
    try { await apiFetch(`/fleet/damage-reports/${id}`, { method: 'PUT', body: JSON.stringify({ repair_status }) }); addToast('Status updated', 'success'); load(); } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to update status', 'error'); }
  };

  // DB stores `repair_cost` + `location`; tolerate the older `repair_estimate`/
  // `location_on_vehicle` shape too so existing rows still render.
  const totalEstimate = reports.reduce((s, r) => s + (r.repair_cost || r.repair_estimate || 0), 0);
  const totalCost = reports.reduce((s, r) => s + (r.repair_cost || 0), 0);

  // Set document title
  useEffect(() => { document.title = 'Fleet - Damage \u2014 RMPG Flex'; }, []);

  return (
    <div className="space-y-3">
      <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
      <FloatingSaveBar visible={isDirty && showForm} onSave={handleSubmit} onCancel={() => { clearDraft(); setShowForm(false); }} isSaving={submitting} saveLabel="Submit" />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-rmpg-100 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Damage Reports</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Report Damage</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="panel-inset p-2 text-center"><p className="field-label">Reports</p><p className="text-sm font-bold text-rmpg-100">{reports.length}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Est. Cost</p><p className="text-sm font-bold text-amber-400 font-mono">${totalEstimate.toLocaleString()}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Actual Cost</p><p className="text-sm font-bold text-red-400 font-mono">${totalCost.toLocaleString()}</p></div>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          {wasRestored && (
            <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30 bg-amber-900/20">
              <div className="flex items-center gap-2">
                <span className="led-dot led-amber" />
                <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
              </div>
              <button type="button" onClick={clearDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">Discard</button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input id="ff-fleetdamagetab-0" type="date" value={form.damage_date} onChange={e => setForm(f => ({ ...f, damage_date: e.target.value }))} className="input-field text-xs" />
            <input id="ff-fleetdamagetab-1" value={form.damage_type} onChange={e => setForm(f => ({ ...f, damage_type: e.target.value }))} className="input-field text-xs" placeholder="Type (dent, scratch...)" />
            <input id="ff-fleetdamagetab-2" value={form.location_on_vehicle} onChange={e => setForm(f => ({ ...f, location_on_vehicle: e.target.value }))} className="input-field text-xs" placeholder="Location on vehicle" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select id="ff-fleetdamagetab-3" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="input-field text-xs">
              <option value="minor">Minor</option><option value="moderate">Moderate</option><option value="major">Major</option><option value="totaled">Totaled</option>
            </select>
            <input id="ff-fleetdamagetab-4" type="number" value={form.repair_estimate} onChange={e => setForm(f => ({ ...f, repair_estimate: e.target.value }))} className="input-field text-xs" placeholder="Repair estimate $" />
            <div />
          </div>
          <RichTextArea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={2} placeholder="Description..." />
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.damage_type.trim() || !form.description.trim()} className="toolbar-btn toolbar-btn-success text-[9px] disabled:opacity-50">{submitting ? 'Submitting...' : 'Submit'}</button>
            <button type="button" onClick={() => { clearDraft(); setShowForm(false); }} disabled={submitting} className="toolbar-btn text-[9px]">Cancel</button>
          </div>
        </div>
      )}

      {reports.map(r => (
        <div key={r.id} className="panel-inset p-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_COLORS[r.severity] || ''}`}>{formatEnumValue(r.severity)}</span>
                <span className="text-[10px] text-rmpg-100 font-bold">{formatEnumValue(r.damage_type)}</span>
                {(r.location_on_vehicle || (r as any).location) && <span className="text-[10px] text-rmpg-400">({r.location_on_vehicle || (r as any).location})</span>}
              </div>
              <p className="text-[10px] text-rmpg-300">{r.description}</p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                <span>{r.damage_date ? parseTimestamp(r.damage_date).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
                <span>By: {r.reported_by_name}</span>
                {(r.repair_cost || r.repair_estimate) && <span>Est: ${r.repair_cost || r.repair_estimate}</span>}
                {r.insurance_claim_number && <span>Claim: {r.insurance_claim_number}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => startEdit(r)} className="toolbar-btn text-[9px]">Edit</button>
              <button type="button" onClick={() => setPendingDelete(r)} className="toolbar-btn text-[9px] text-red-400">Del</button>
              <span className={`text-[9px] font-bold ${REPAIR_COLORS[r.repair_status] || 'text-rmpg-400'}`}>{toDisplayLabel(r.repair_status || '')}</span>
              {r.repair_status !== 'completed' && (
                <select id="ff-fleetdamagetab-5" value={r.repair_status} onChange={e => updateRepairStatus(r.id, e.target.value)} className="input-field text-[9px] py-0.5 px-1">
                  <option value="reported">Reported</option><option value="estimated">Estimated</option>
                  <option value="approved">Approved</option><option value="in_repair">In Repair</option>
                  <option value="completed">Completed</option><option value="insurance_claim">Insurance</option>
                </select>
              )}
            </div>
          </div>
        </div>
      ))}
      <ConfirmDialog
        isOpen={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const r = pendingDelete;
          setPendingDelete(null);
          if (r) void handleDelete(r);
        }}
        title="Delete damage report"
        message={pendingDelete ? `Delete this ${pendingDelete.severity} ${pendingDelete.damage_type} report?` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
