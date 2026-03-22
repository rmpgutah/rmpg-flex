import React, { useState, useEffect } from 'react';
import { Plus, AlertOctagon, Clock, CheckCircle, Search } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { useAuth } from '../../../context/AuthContext';

interface Grievance {
  id: number;
  officer_id: number;
  officer_name: string;
  type: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  resolution: string | null;
  filed_at: string;
  resolved_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  filed: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  under_review: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  investigation: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  mediation: 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50',
  resolved: 'bg-green-900/50 text-green-400 border border-green-700/50',
  dismissed: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
  appealed: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export default function GrievancesTab() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [form, setForm] = useState({ type: 'general', subject: '', description: '', priority: 'normal' });

  const isManager = ['admin', 'manager', 'supervisor'].includes(user?.role || '');

  const load = async () => {
    setLoading(true);
    try {
      const params = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const data = await apiFetch<Grievance[]>(`/hr/grievances${params}`);
      setGrievances(data);
    } catch { /* handled */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterStatus]);

  const handleSubmit = async () => {
    if (!form.subject || !form.description) { addToast('Subject and description required', 'error'); return; }
    try {
      await apiFetch('/hr/grievances', { method: 'POST', body: JSON.stringify(form) });
      addToast('Grievance filed', 'success'); setShowForm(false); setForm({ type: 'general', subject: '', description: '', priority: 'normal' }); load();
    } catch { addToast('Failed to file grievance', 'error'); }
  };

  const updateStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/hr/grievances/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast('Status updated', 'success'); load();
    } catch { /* handled */ }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-white flex items-center gap-2"><AlertOctagon className="w-4 h-4" /> Grievances</h2>
        <div className="flex items-center gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field text-xs py-1 px-2">
            <option value="all">All Statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button onClick={() => setShowForm(!showForm)} className="toolbar-btn toolbar-btn-success text-xs"><Plus className="w-3 h-3" /> File Grievance</button>
        </div>
      </div>

      {showForm && (
        <div className="panel-beveled p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input-field w-full text-xs">
                <option value="general">General</option>
                <option value="workplace">Workplace</option>
                <option value="harassment">Harassment</option>
                <option value="discrimination">Discrimination</option>
                <option value="safety">Safety</option>
                <option value="policy">Policy</option>
              </select>
            </div>
            <div>
              <label className="field-label">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input-field w-full text-xs">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Subject</label>
            <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className="input-field w-full text-xs" placeholder="Brief subject line" />
          </div>
          <div>
            <label className="field-label">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="input-field w-full text-xs" rows={4} placeholder="Detailed description of the grievance..." />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSubmit} className="toolbar-btn toolbar-btn-success text-xs">Submit Grievance</button>
            <button onClick={() => setShowForm(false)} className="toolbar-btn text-xs">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">Loading...</div>
      ) : grievances.length === 0 ? (
        <div className="text-center text-rmpg-400 py-8 text-xs">No grievances found</div>
      ) : (
        <div className="space-y-2">
          {grievances.map(g => (
            <div key={g.id} className="panel-beveled p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[g.status] || STATUS_COLORS.filed}`}>{g.status.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-rmpg-400 uppercase">{g.type}</span>
                    <span className="text-[10px] text-rmpg-500">{g.priority}</span>
                  </div>
                  <h3 className="text-xs font-bold text-white">{g.subject}</h3>
                  <p className="text-[10px] text-rmpg-300 mt-1 line-clamp-2">{g.description}</p>
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-rmpg-400">
                    <span>Filed by: {g.officer_name}</span>
                    <span>Date: {g.filed_at?.substring(0, 10)}</span>
                    {g.assigned_to_name && <span>Assigned: {g.assigned_to_name}</span>}
                    {g.resolved_at && <span>Resolved: {g.resolved_at.substring(0, 10)}</span>}
                  </div>
                </div>
                {isManager && g.status !== 'resolved' && g.status !== 'dismissed' && (
                  <div className="flex gap-1">
                    {g.status === 'filed' && <button onClick={() => updateStatus(g.id, 'under_review')} className="toolbar-btn text-[9px]">Review</button>}
                    {g.status === 'under_review' && <button onClick={() => updateStatus(g.id, 'investigation')} className="toolbar-btn text-[9px]">Investigate</button>}
                    <button onClick={() => updateStatus(g.id, 'resolved')} className="toolbar-btn toolbar-btn-success text-[9px]"><CheckCircle className="w-3 h-3" /></button>
                    <button onClick={() => updateStatus(g.id, 'dismissed')} className="toolbar-btn toolbar-btn-danger text-[9px]">Dismiss</button>
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
