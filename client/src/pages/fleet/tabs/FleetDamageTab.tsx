import React, { useState, useEffect } from 'react';
import { AlertTriangle, Plus, Wrench } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { useToast } from '../../../components/ToastProvider';
import FloatingSaveBar from '../../../components/FloatingSaveBar';
import UnsavedChangesGuard from '../../../components/UnsavedChangesGuard';
import { localToday } from '../../../utils/dateUtils';

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
  minor: 'bg-gray-900/50 text-gray-400 border border-gray-700/50',
  moderate: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  major: 'bg-red-900/50 text-red-400 border border-red-700/50',
  totaled: 'bg-red-900/70 text-red-300 border border-red-600/50',
};

const REPAIR_COLORS: Record<string, string> = {
  reported: 'text-gray-400', estimated: 'text-amber-400', approved: 'text-purple-400',
  in_repair: 'text-gray-400', completed: 'text-green-400', insurance_claim: 'text-amber-400',
};

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function FleetDamageTab({ vehicleId }: { vehicleId: number | string }) {
  const { addToast } = useToast();
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft({
    storageKey: 'rmpg_fleet_damage_form',
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
      const data = await apiFetch<DamageReport[]>(`/fleet/${vehicleId}/damage-reports`); setReports(data);
    } catch { addToast('Failed to load damage reports', 'error'); } finally { setLoading(false); }
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
    setSubmitting(true);
    try { await apiFetch(`/fleet/${vehicleId}/damage-reports`, {
      method: 'POST', body: JSON.stringify({ ...form, repair_estimate: form.repair_estimate ? Number(form.repair_estimate) : null }),
    }); addToast('Damage reported', 'success'); clearDraft(); setShowForm(false); load(); } catch { addToast('Failed to report damage', 'error'); } finally { setSubmitting(false); }
  };

  const updateRepairStatus = async (id: number, repair_status: string) => {
    try { await apiFetch(`/fleet/damage-reports/${id}`, { method: 'PUT', body: JSON.stringify({ repair_status }) }); addToast('Status updated', 'success'); load(); } catch { addToast('Failed to update status', 'error'); }
  };

  const totalEstimate = reports.reduce((s, r) => s + (r.repair_estimate || 0), 0);
  const totalCost = reports.reduce((s, r) => s + (r.repair_cost || 0), 0);

  // Set document title
  useEffect(() => { document.title = 'Fleet - Damage \u2014 RMPG Flex'; }, []);

  return (
    <div className="space-y-3">
      <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
      <FloatingSaveBar visible={isDirty && showForm} onSave={handleSubmit} onCancel={() => { clearDraft(); setShowForm(false); }} isSaving={submitting} saveLabel="Submit" />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Damage Reports</h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Report Damage</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="panel-inset p-2 text-center"><p className="field-label">Reports</p><p className="text-sm font-bold text-white">{reports.length}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Est. Cost</p><p className="text-sm font-bold text-amber-400 font-mono">${totalEstimate.toLocaleString()}</p></div>
        <div className="panel-inset p-2 text-center"><p className="field-label">Actual Cost</p><p className="text-sm font-bold text-red-400 font-mono">${totalCost.toLocaleString()}</p></div>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          {wasRestored && (
            <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: '#1a1500' }}>
              <div className="flex items-center gap-2">
                <span className="led-dot led-amber" />
                <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
              </div>
              <button type="button" onClick={clearDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">Discard</button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input type="date" value={form.damage_date} onChange={e => setForm(f => ({ ...f, damage_date: e.target.value }))} className="input-field text-xs" />
            <input value={form.damage_type} onChange={e => setForm(f => ({ ...f, damage_type: e.target.value }))} className="input-field text-xs" placeholder="Type (dent, scratch...)" />
            <input value={form.location_on_vehicle} onChange={e => setForm(f => ({ ...f, location_on_vehicle: e.target.value }))} className="input-field text-xs" placeholder="Location on vehicle" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="input-field text-xs">
              <option value="minor">Minor</option><option value="moderate">Moderate</option><option value="major">Major</option><option value="totaled">Totaled</option>
            </select>
            <input type="number" value={form.repair_estimate} onChange={e => setForm(f => ({ ...f, repair_estimate: e.target.value }))} className="input-field text-xs" placeholder="Repair estimate $" />
            <div />
          </div>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={2} placeholder="Description..." />
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
                <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase ${SEVERITY_COLORS[r.severity] || ''}`}>{r.severity}</span>
                <span className="text-[10px] text-white font-bold">{r.damage_type}</span>
                {r.location_on_vehicle && <span className="text-[10px] text-rmpg-400">({r.location_on_vehicle})</span>}
              </div>
              <p className="text-[10px] text-rmpg-300">{r.description}</p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
                <span>{r.damage_date ? new Date(r.damage_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
                <span>By: {r.reported_by_name}</span>
                {r.repair_estimate && <span>Est: ${r.repair_estimate}</span>}
                {r.repair_cost && <span>Cost: ${r.repair_cost}</span>}
                {r.insurance_claim_number && <span>Claim: {r.insurance_claim_number}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className={`text-[9px] font-bold ${REPAIR_COLORS[r.repair_status] || 'text-rmpg-400'}`}>{r.repair_status?.replace(/_/g, ' ')}</span>
              {r.repair_status !== 'completed' && (
                <select value={r.repair_status} onChange={e => updateRepairStatus(r.id, e.target.value)} className="input-field text-[9px] py-0.5 px-1">
                  <option value="reported">Reported</option><option value="estimated">Estimated</option>
                  <option value="approved">Approved</option><option value="in_repair">In Repair</option>
                  <option value="completed">Completed</option><option value="insurance_claim">Insurance</option>
                </select>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
