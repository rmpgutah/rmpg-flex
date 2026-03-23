import React, { useState, useEffect } from 'react';
import { AlertOctagon, Plus, CheckCircle, Calendar, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

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

  const load = async () => {
    setLoading(true);
    try {
      const params = vehicleId ? `?vehicle_id=${vehicleId}` : '';
      try { const data = await apiFetch<any[]>(`/fleet/recalls${params}`); setRecalls(data); } catch { /* handled */ }
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
    setSubmitting(true);
    try { await apiFetch('/fleet/recalls', { method: 'POST', body: JSON.stringify({ ...form, vehicle_id: Number(form.vehicle_id) }) }); addToast('Recall created', 'success'); setShowForm(false); load(); } catch { addToast('Failed to create recall', 'error'); } finally { setSubmitting(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    const body: any = { status };
    if (status === 'completed') body.completed_date = new Date().toISOString().slice(0, 10);
    try { await apiFetch<any[]>(`/fleet/recalls/${id}`, { method: 'PUT', body: JSON.stringify(body) }); addToast('Recall updated', 'success'); load(); } catch { /* handled */ }
  };

  const openCount = recalls.filter(r => r.status === 'open').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white flex items-center gap-1">
          <AlertOctagon className="w-3.5 h-3.5 text-red-400" /> Recall Alerts
          {openCount > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-900/50 text-red-400 text-[9px] font-bold">{openCount} OPEN</span>}
        </h3>
        <button type="button" onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-[9px]"><Plus className="w-3 h-3" /> Add Recall</button>
      </div>

      {showForm && (
        <div className="panel-inset p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input value={form.recall_number} onChange={e => setForm(f => ({ ...f, recall_number: e.target.value }))} className="input-field text-xs" placeholder="Recall #" />
            <input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="input-field text-xs" placeholder="Manufacturer" />
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="input-field text-xs">
              <option value="standard">Standard</option><option value="safety">Safety</option><option value="critical">Critical</option>
            </select>
          </div>
          <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={2} placeholder="Description..." />
          <input value={form.remedy} onChange={e => setForm(f => ({ ...f, remedy: e.target.value }))} className="input-field w-full text-xs" placeholder="Remedy..." />
          <div className="flex gap-2">
            <button type="button" onClick={handleSubmit} className="toolbar-btn toolbar-btn-success text-[9px]">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="toolbar-btn text-[9px]">Cancel</button>
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
                    <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded-sm ${STATUS_COLORS[r.status] || ''}`}>{r.status.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-white font-bold font-mono">{r.recall_number}</span>
                    {!vehicleId && <span className="text-[10px] text-rmpg-300">{r.vehicle_number} ({r.year} {r.make} {r.model})</span>}
                  </div>
                  <p className="text-[10px] text-rmpg-200">{r.description}</p>
                  {r.remedy && <p className="text-[10px] text-rmpg-400 mt-1">Remedy: {r.remedy}</p>}
                  {r.completed_date && <p className="text-[10px] text-green-400">Completed: {new Date(r.completed_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                </div>
                {r.status !== 'completed' && r.status !== 'not_applicable' && (
                  <div className="flex gap-1">
                    {r.status === 'open' && <button type="button" onClick={() => updateStatus(r.id, 'scheduled')} className="toolbar-btn text-[9px]"><Calendar className="w-3 h-3" /> Schedule</button>}
                    <button type="button" onClick={() => updateStatus(r.id, 'completed')} className="toolbar-btn toolbar-btn-success text-[9px]"><CheckCircle className="w-3 h-3" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
