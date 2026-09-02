import { useState, useEffect } from 'react';
import { AlertOctagon, Plus, CheckCircle, Calendar, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { localToday, parseTimestamp } from '../../../utils/dateUtils';

import RichTextArea from '../../../components/RichTextArea';
import { toDisplayLabel } from '../../../utils/formatters';
interface Recall {
  id: number;
  vehicle_id: number;
  vehicle_number: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  recall_number: string;
  manufacturer: string;
  description: string;
  severity: string;
  status: string;
  remedy: string;
  scheduled_date: string;
  completed_date: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-900/50 text-red-400 border border-red-700/50',
  scheduled: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border border-green-700/50',
  not_applicable: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
};

export default function FleetRecallsTab({ vehicleId }: { vehicleId?: number | string }) {
  const { addToast } = useToast();
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ vehicle_id: vehicleId || '', recall_number: '', manufacturer: '', description: '', severity: 'standard', remedy: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Recall | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
      // GET /fleet/recalls always returns an array server-side, but a stale
      // cached response (service worker, edge cache) or any other unexpected
      // 200 body would otherwise crash `recalls.filter(...)` below with
      // "not a function" — confirmed live in production (2026-07-30).
      try { const data = await apiFetch<any[]>(`/fleet/recalls${params}`); setRecalls(Array.isArray(data) ? data : []); } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to load recalls', 'error'); }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [vehicleId]);

  // Escape to close form
  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowForm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  const handleSubmit = async () => {
    if (!form.recall_number.trim()) { addToast('Recall number is required', 'error'); return; }
    if (!form.description.trim()) { addToast('Description is required', 'error'); return; }
    const vid = Number(form.vehicle_id);
    if (!Number.isInteger(vid) || vid <= 0) { addToast('A valid vehicle is required for a recall', 'error'); return; }
    if (submitting) return;
    setSubmitting(true);
    // Map UI fields to the handler's columns (nhtsa_number / issue_date / notes).
    const payload = {
      nhtsa_number: form.recall_number.trim(),
      description: form.description.trim(),
      severity: form.severity,
      notes: [form.manufacturer && `Mfr: ${form.manufacturer}`, form.remedy && `Remedy: ${form.remedy}`].filter(Boolean).join(' — ') || null,
    };
    try {
      if (editingId != null) {
        await apiFetch(`/fleet/recalls/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        addToast('Recall updated', 'success');
      } else {
        await apiFetch('/fleet/recalls', { method: 'POST', body: JSON.stringify({ ...payload, vehicle_id: vid, issue_date: localToday() }) });
        addToast('Recall created', 'success');
      }
      setShowForm(false); setEditingId(null);
      setForm({ vehicle_id: vehicleId || '', recall_number: '', manufacturer: '', description: '', severity: 'standard', remedy: '' });
      load();
    } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to save recall', 'error'); } finally { setSubmitting(false); }
  };

  const startEdit = (r: Recall) => {
    setForm({
      vehicle_id: r.vehicle_id || vehicleId || '',
      recall_number: r.recall_number || (r as any).nhtsa_number || '',
      manufacturer: r.manufacturer || '',
      description: r.description || '',
      severity: r.severity || 'standard',
      remedy: r.remedy || '',
    });
    setEditingId(r.id);
    setShowForm(true);
  };

  const handleDelete = async (r: Recall) => {
    try { await apiFetch(`/fleet/recalls/${r.id}`, { method: 'DELETE' }); addToast('Recall deleted', 'success'); load(); }
    catch (e) { addToast(e instanceof Error ? e.message : 'Failed to delete recall', 'error'); }
  };

  const updateStatus = async (id: number, status: string) => {
    const body: any = { status };
    if (status === 'completed') body.remedy_date = localToday();
    try { await apiFetch<any[]>(`/fleet/recalls/${id}`, { method: 'PUT', body: JSON.stringify(body) }); addToast('Recall updated', 'success'); load(); } catch (e) { addToast(e instanceof Error ? e.message : 'Failed to update recall', 'error'); }
  };

  const openCount = recalls.filter(r => r.status === 'open').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-rmpg-100 flex items-center gap-1">
          <AlertOctagon className="w-3.5 h-3.5 text-red-400" /> Recall Alerts
          {openCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-900/50 text-red-400 text-[9px] font-bold">{openCount} OPEN</span>}
        </h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add Recall</button>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input id="ff-fleetrecallstab-0" value={form.recall_number} onChange={e => setForm(f => ({ ...f, recall_number: e.target.value }))} className="input-field text-xs" placeholder="Recall #" />
            <input id="ff-fleetrecallstab-1" value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="input-field text-xs" placeholder="Manufacturer" />
            <select id="ff-fleetrecallstab-2" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="input-field text-xs">
              <option value="standard">Standard</option><option value="safety">Safety</option><option value="critical">Critical</option>
            </select>
          </div>
          <RichTextArea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={2} placeholder="Description..." />
          <input id="ff-fleetrecallstab-3" value={form.remedy} onChange={e => setForm(f => ({ ...f, remedy: e.target.value }))} className="input-field w-full text-xs" placeholder="Remedy..." />
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} disabled={submitting || !form.recall_number.trim()} className="toolbar-btn toolbar-btn-success text-[9px] disabled:opacity-50">{submitting ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} disabled={submitting} className="toolbar-btn text-[9px]">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-rmpg-400 py-4 text-xs"><Loader2 className="w-4 h-4 animate-spin" role="status" aria-label="Loading" /> Loading recalls...</div>
      ) : recalls.length === 0 ? (
        <div className="text-center text-green-400 py-4 text-xs"><CheckCircle className="w-4 h-4 inline mr-1" /> No active recalls</div>
      ) : (
        <div className="space-y-2">
          {recalls.map(r => (
            <div key={r.id} className={`panel-inset p-2 hover:bg-surface-raised/30 transition-colors ${r.status === 'open' ? 'border-l-2 border-l-red-500' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${STATUS_COLORS[r.status] || ''}`}>{toDisplayLabel(r.status)}</span>
                    <span className="text-[10px] text-rmpg-100 font-bold font-mono">{r.recall_number || (r as any).nhtsa_number}</span>
                    {!vehicleId && <span className="text-[10px] text-rmpg-300">{r.vehicle_number} ({r.year} {r.make} {r.model})</span>}
                  </div>
                  <p className="text-[10px] text-rmpg-200">{r.description}</p>
                  {r.remedy && <p className="text-[10px] text-rmpg-400 mt-1">Remedy: {r.remedy}</p>}
                  {(r.completed_date || (r as any).remedy_date) && <p className="text-[10px] text-green-400">Completed: {parseTimestamp(r.completed_date || (r as any).remedy_date).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => startEdit(r)} className="toolbar-btn text-[9px]">Edit</button>
                  <button type="button" onClick={() => setPendingDelete(r)} className="toolbar-btn text-[9px] text-red-400">Del</button>
                  {r.status !== 'completed' && r.status !== 'not_applicable' && (
                    <>
                      {r.status === 'open' && <button type="button" onClick={() => updateStatus(r.id, 'scheduled')} className="toolbar-btn text-[9px]"><Calendar className="w-3 h-3" /> Schedule</button>}
                      <button aria-label="Mark complete" type="button" onClick={() => updateStatus(r.id, 'completed')} className="toolbar-btn toolbar-btn-success text-[9px]"><CheckCircle className="w-3 h-3" /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const r = pendingDelete;
          setPendingDelete(null);
          if (r) void handleDelete(r);
        }}
        title="Delete recall"
        message={pendingDelete ? `Delete recall ${pendingDelete.recall_number || (pendingDelete as any).nhtsa_number || pendingDelete.id}?` : ''}
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
